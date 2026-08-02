begin;

create table if not exists public.financial_months (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reference_year integer not null check (reference_year between 1900 and 2200),
  reference_month integer not null check (reference_month between 1 and 12),
  period_start timestamptz not null,
  period_end timestamptz not null,
  timezone text not null default 'America/Fortaleza',
  status text not null default 'open' check (status in ('open','awaiting_consolidation','review','closing','closed','reopened')),
  recommended_close_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopen_reason text check (reopen_reason is null or char_length(reopen_reason) between 3 and 1000),
  current_report_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, reference_year, reference_month),
  check (period_end > period_start)
);

create table if not exists public.monthly_financial_reports (
  id uuid primary key default gen_random_uuid(),
  financial_month_id uuid not null references public.financial_months(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'generating' check (status in ('draft','generating','final','generation_failed','superseded')),
  snapshot_schema_version integer not null default 1,
  snapshot_json jsonb not null,
  snapshot_hash text not null,
  opening_balance numeric(15,2) not null default 0,
  closing_balance numeric(15,2) not null default 0,
  total_income numeric(15,2) not null default 0,
  total_bank_outflows numeric(15,2) not null default 0,
  cash_result numeric(15,2) not null default 0,
  personal_consumption numeric(15,2) not null default 0,
  total_card_consumption numeric(15,2) not null default 0,
  third_party_card_consumption numeric(15,2) not null default 0,
  reimbursements_received numeric(15,2) not null default 0,
  reimbursements_pending numeric(15,2) not null default 0,
  future_commitments numeric(15,2) not null default 0,
  pdf_storage_path text,
  pdf_hash text,
  pdf_generated_at timestamptz,
  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id) on delete set null,
  supersedes_report_id uuid references public.monthly_financial_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (financial_month_id, version)
);

alter table public.financial_months drop constraint if exists financial_months_current_report_id_fkey;
alter table public.financial_months add constraint financial_months_current_report_id_fkey
  foreign key (current_report_id) references public.monthly_financial_reports(id) on delete set null;

create table if not exists public.monthly_report_issues (
  id uuid primary key default gen_random_uuid(),
  financial_month_id uuid not null references public.financial_months(id) on delete cascade,
  report_id uuid references public.monthly_financial_reports(id) on delete cascade,
  issue_key text not null,
  issue_type text not null,
  severity text not null check (severity in ('info','warning','blocking')),
  title text not null,
  description text,
  related_entity_type text,
  related_entity_id uuid,
  amount numeric(15,2),
  resolved boolean not null default false,
  resolution_type text,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (financial_month_id, issue_key)
);

create table if not exists public.monthly_report_audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  financial_month_id uuid not null references public.financial_months(id) on delete cascade,
  report_id uuid references public.monthly_financial_reports(id) on delete set null,
  action text not null,
  performed_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.credit_card_instruments
  add column if not exists cardholder_person_id uuid references public.financial_people(id) on delete set null,
  add column if not exists default_financial_responsible_id uuid references public.financial_people(id) on delete set null,
  add column if not exists responsibility_mode text not null default 'uncertain'
    check (responsibility_mode in ('own_expense','third_party_expense','shared_expense','business_reimbursable','uncertain'));

alter table public.card_purchases
  add column if not exists cardholder_person_id uuid references public.financial_people(id) on delete set null,
  add column if not exists financial_responsible_id uuid references public.financial_people(id) on delete set null,
  add column if not exists responsibility_type text not null default 'uncertain'
    check (responsibility_type in ('own_expense','third_party_expense','shared_expense','business_reimbursable','uncertain')),
  add column if not exists personal_share_amount numeric(15,2),
  add column if not exists third_party_share_amount numeric(15,2),
  add column if not exists responsibility_confirmed boolean not null default false,
  add column if not exists responsibility_note text,
  add column if not exists posted_date date,
  add column if not exists date_source text;

alter table public.card_invoices
  add column if not exists official_total_amount numeric(15,2),
  add column if not exists calculated_total_amount numeric(15,2),
  add column if not exists official_amount_source text check (official_amount_source is null or official_amount_source in ('provider','manual','statement_pdf')),
  add column if not exists official_amount_confirmed boolean not null default false,
  add column if not exists statement_period_start date,
  add column if not exists statement_period_end date,
  add column if not exists statement_file_path text,
  add column if not exists statement_file_name text,
  add column if not exists statement_file_hash text,
  add column if not exists reconciliation_note text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

create index if not exists financial_months_workspace_period on public.financial_months(workspace_id, reference_year desc, reference_month desc);
create index if not exists monthly_reports_month_version on public.monthly_financial_reports(financial_month_id, version desc);
create index if not exists monthly_issues_open on public.monthly_report_issues(financial_month_id, severity) where not resolved;
create index if not exists monthly_audit_month on public.monthly_report_audit_logs(financial_month_id, created_at desc);

create or replace function public.protect_final_monthly_report()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status in ('final','superseded') and (
    new.snapshot_json is distinct from old.snapshot_json or
    new.snapshot_hash is distinct from old.snapshot_hash or
    new.version is distinct from old.version or
    new.financial_month_id is distinct from old.financial_month_id or
    new.workspace_id is distinct from old.workspace_id
  ) then
    raise exception 'O snapshot de um relatório final não pode ser alterado.' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.validate_financial_month_transition()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status=old.status then return new; end if;
  if not (
    (old.status='open' and new.status='awaiting_consolidation') or
    (old.status='awaiting_consolidation' and new.status='review') or
    (old.status='review' and new.status='closing') or
    (old.status='closing' and new.status='closed') or
    (old.status='closed' and new.status='reopened') or
    (old.status='reopened' and new.status='review')
  ) then raise exception 'Transição inválida para o mês financeiro: % -> %',old.status,new.status using errcode='23514'; end if;
  return new;
end $$;

drop trigger if exists monthly_report_immutable on public.monthly_financial_reports;
create trigger monthly_report_immutable before update on public.monthly_financial_reports
for each row execute function public.protect_final_monthly_report();
drop trigger if exists financial_month_status_transition on public.financial_months;
create trigger financial_month_status_transition before update of status on public.financial_months
for each row execute function public.validate_financial_month_transition();

do $$ declare relation text; begin
  foreach relation in array array['financial_months','monthly_financial_reports','monthly_report_issues'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', relation, relation);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', relation, relation);
    execute format('alter table public.%I enable row level security', relation);
  end loop;
end $$;
alter table public.monthly_report_audit_logs enable row level security;

drop policy if exists financial_months_read on public.financial_months;
drop policy if exists financial_months_create on public.financial_months;
drop policy if exists financial_months_admin on public.financial_months;
drop policy if exists monthly_reports_read on public.monthly_financial_reports;
drop policy if exists monthly_issues_read on public.monthly_report_issues;
drop policy if exists monthly_issues_admin on public.monthly_report_issues;
drop policy if exists monthly_audit_read on public.monthly_report_audit_logs;
drop policy if exists monthly_audit_admin_insert on public.monthly_report_audit_logs;
drop policy if exists card_invoices_workspace_monthly_read on public.card_invoices;
drop policy if exists card_invoices_workspace_monthly_admin on public.card_invoices;
create policy financial_months_read on public.financial_months for select to authenticated using (public.is_workspace_member(workspace_id));
create policy financial_months_create on public.financial_months for insert to authenticated with check (public.is_workspace_member(workspace_id));
create policy financial_months_admin on public.financial_months for update to authenticated using (public.can_admin_workspace(workspace_id)) with check (public.can_admin_workspace(workspace_id));
create policy monthly_reports_read on public.monthly_financial_reports for select to authenticated using (public.is_workspace_member(workspace_id));
create policy monthly_issues_read on public.monthly_report_issues for select to authenticated using (public.is_workspace_member((select workspace_id from public.financial_months where id=financial_month_id)));
create policy monthly_issues_admin on public.monthly_report_issues for all to authenticated using (public.can_admin_workspace((select workspace_id from public.financial_months where id=financial_month_id))) with check (public.can_admin_workspace((select workspace_id from public.financial_months where id=financial_month_id)));
create policy monthly_audit_read on public.monthly_report_audit_logs for select to authenticated using (public.is_workspace_member(workspace_id));
create policy monthly_audit_admin_insert on public.monthly_report_audit_logs for insert to authenticated with check (public.can_admin_workspace(workspace_id) and performed_by=auth.uid());
create policy card_invoices_workspace_monthly_read on public.card_invoices for select to authenticated
  using (exists (select 1 from public.credit_cards card where card.id=card_id and card.workspace_id is not null and public.is_workspace_member(card.workspace_id)));
create policy card_invoices_workspace_monthly_admin on public.card_invoices for update to authenticated
  using (exists (select 1 from public.credit_cards card where card.id=card_id and card.workspace_id is not null and public.can_admin_workspace(card.workspace_id)))
  with check (exists (select 1 from public.credit_cards card where card.id=card_id and card.workspace_id is not null and public.can_admin_workspace(card.workspace_id)));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('financial-reports','financial-reports',false,20971520,array['application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists financial_reports_select on storage.objects;
drop policy if exists financial_reports_insert on storage.objects;
drop policy if exists financial_reports_update on storage.objects;
create policy financial_reports_select on storage.objects for select to authenticated
  using (bucket_id='financial-reports' and public.is_workspace_member(((storage.foldername(name))[1])::uuid));
create policy financial_reports_insert on storage.objects for insert to authenticated
  with check (bucket_id='financial-reports' and public.can_admin_workspace(((storage.foldername(name))[1])::uuid));
create policy financial_reports_update on storage.objects for update to authenticated
  using (bucket_id='financial-reports' and public.can_admin_workspace(((storage.foldername(name))[1])::uuid));

create or replace function public.close_financial_month(
  p_month_id uuid,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_totals jsonb
) returns public.monthly_financial_reports
language plpgsql security definer set search_path=''
as $$
declare
  target public.financial_months;
  previous_report public.monthly_financial_reports;
  created_report public.monthly_financial_reports;
  next_version integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_month_id::text, 0));
  select * into target from public.financial_months where id=p_month_id for update;
  if target.id is null or not public.can_admin_workspace(target.workspace_id) then raise exception 'Você não pode concluir este mês.' using errcode='42501'; end if;
  if target.period_end > now() then raise exception 'Este mês ainda não terminou.' using errcode='22023'; end if;
  if target.status not in ('review','closed') then raise exception 'Este mês não está pronto para conclusão.' using errcode='22023'; end if;
  if target.current_report_id is not null then
    select * into previous_report from public.monthly_financial_reports where id=target.current_report_id;
    if target.status='closed' and previous_report.snapshot_hash=p_snapshot_hash then return previous_report; end if;
    if target.status='closed' then raise exception 'Reabra o mês antes de gerar uma nova versão.' using errcode='22023'; end if;
  end if;
  update public.financial_months set status='closing' where id=target.id;
  select coalesce(max(version),0)+1 into next_version from public.monthly_financial_reports where financial_month_id=target.id;
  insert into public.monthly_financial_reports(
    financial_month_id,workspace_id,version,status,snapshot_json,snapshot_hash,generated_by,supersedes_report_id,
    opening_balance,closing_balance,total_income,total_bank_outflows,cash_result,personal_consumption,total_card_consumption,
    third_party_card_consumption,reimbursements_received,reimbursements_pending,future_commitments
  ) values (
    target.id,target.workspace_id,next_version,'generating',p_snapshot,p_snapshot_hash,auth.uid(),previous_report.id,
    coalesce((p_totals->>'openingBalance')::numeric,0),coalesce((p_totals->>'closingBalance')::numeric,0),
    coalesce((p_totals->>'totalIncome')::numeric,0),coalesce((p_totals->>'totalBankOutflows')::numeric,0),
    coalesce((p_totals->>'cashResult')::numeric,0),coalesce((p_totals->>'personalConsumption')::numeric,0),
    coalesce((p_totals->>'totalCardConsumption')::numeric,0),coalesce((p_totals->>'thirdPartyCardConsumption')::numeric,0),
    coalesce((p_totals->>'reimbursementsReceived')::numeric,0),coalesce((p_totals->>'reimbursementsPending')::numeric,0),
    coalesce((p_totals->>'futureCommitments')::numeric,0)
  ) returning * into created_report;
  if previous_report.id is not null then update public.monthly_financial_reports set status='superseded' where id=previous_report.id; end if;
  update public.financial_months set status='closed',closed_at=now(),closed_by=auth.uid(),current_report_id=created_report.id where id=target.id;
  insert into public.monthly_report_audit_logs(workspace_id,financial_month_id,report_id,action,performed_by,metadata)
    values(target.workspace_id,target.id,created_report.id,'month_closed',auth.uid(),jsonb_build_object('version',next_version,'snapshot_hash',p_snapshot_hash));
  return created_report;
end $$;

create or replace function public.finalize_monthly_report_pdf(p_report_id uuid,p_path text,p_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.monthly_financial_reports;
begin
  select * into target from public.monthly_financial_reports where id=p_report_id for update;
  if target.id is null or not public.can_admin_workspace(target.workspace_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if target.status not in ('generating','generation_failed') then raise exception 'Este relatório não aguarda PDF.' using errcode='22023'; end if;
  update public.monthly_financial_reports set status='final',pdf_storage_path=p_path,pdf_hash=p_hash,pdf_generated_at=now() where id=target.id;
  insert into public.monthly_report_audit_logs(workspace_id,financial_month_id,report_id,action,performed_by)
    values(target.workspace_id,target.financial_month_id,target.id,'pdf_generated',auth.uid());
end $$;

create or replace function public.mark_monthly_report_pdf_failed(p_report_id uuid,p_message text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.monthly_financial_reports;
begin
  select * into target from public.monthly_financial_reports where id=p_report_id for update;
  if target.id is null or not public.can_admin_workspace(target.workspace_id) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  update public.monthly_financial_reports set status='generation_failed' where id=target.id and status='generating';
  insert into public.monthly_report_audit_logs(workspace_id,financial_month_id,report_id,action,performed_by,metadata)
    values(target.workspace_id,target.financial_month_id,target.id,'pdf_generation_failed',auth.uid(),jsonb_build_object('message',left(p_message,500)));
end $$;

create or replace function public.reopen_financial_month(p_month_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare target public.financial_months;
begin
  select * into target from public.financial_months where id=p_month_id for update;
  if target.id is null or not public.can_admin_workspace(target.workspace_id) then raise exception 'Você não pode reabrir este mês.' using errcode='42501'; end if;
  if target.status<>'closed' then raise exception 'Somente um mês concluído pode ser reaberto.' using errcode='22023'; end if;
  if char_length(trim(coalesce(p_reason,'')))<3 then raise exception 'Informe o motivo da reabertura.' using errcode='22023'; end if;
  update public.financial_months set status='reopened',reopened_at=now(),reopened_by=auth.uid(),reopen_reason=trim(p_reason) where id=target.id;
  insert into public.monthly_report_audit_logs(workspace_id,financial_month_id,report_id,action,performed_by,metadata)
    values(target.workspace_id,target.id,target.current_report_id,'month_reopened',auth.uid(),jsonb_build_object('reason',trim(p_reason)));
end $$;

grant select,insert on public.financial_months to authenticated;
grant select on public.monthly_financial_reports to authenticated;
grant select,insert on public.monthly_report_audit_logs to authenticated;
grant select,insert,update on public.monthly_report_issues to authenticated;
grant execute on function public.close_financial_month(uuid,jsonb,text,jsonb),public.finalize_monthly_report_pdf(uuid,text,text),public.mark_monthly_report_pdf_failed(uuid,text),public.reopen_financial_month(uuid,text) to authenticated;

commit;
