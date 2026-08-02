begin;

alter table public.profiles
  add column if not exists financial_tracking_started_at timestamptz,
  add column if not exists financial_tracking_start_year integer check (financial_tracking_start_year is null or financial_tracking_start_year between 1900 and 2200),
  add column if not exists financial_tracking_start_month integer check (financial_tracking_start_month is null or financial_tracking_start_month between 1 and 12),
  add column if not exists financial_tracking_started_by uuid references auth.users(id) on delete set null,
  add column if not exists financial_tracking_start_source text check (financial_tracking_start_source is null or financial_tracking_start_source in ('finance_module_activation','first_account_connection','manual_configuration','migration'));

alter table public.financial_people
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists financial_tracking_started_at timestamptz,
  add column if not exists financial_tracking_start_year integer check (financial_tracking_start_year is null or financial_tracking_start_year between 1900 and 2200),
  add column if not exists financial_tracking_start_month integer check (financial_tracking_start_month is null or financial_tracking_start_month between 1 and 12),
  add column if not exists financial_tracking_started_by uuid references auth.users(id) on delete set null,
  add column if not exists financial_tracking_start_source text check (financial_tracking_start_source is null or financial_tracking_start_source in ('finance_module_activation','first_account_connection','manual_configuration','migration'));

create unique index if not exists financial_people_workspace_user_unique
  on public.financial_people(workspace_id,user_id) where user_id is not null and archived_at is null;

create table if not exists public.workspace_financial_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  financial_participation_started_at timestamptz not null,
  financial_participation_ended_at timestamptz,
  include_in_shared_reports boolean not null default false,
  can_view_previous_reports boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,person_id),
  check (financial_participation_ended_at is null or financial_participation_ended_at >= financial_participation_started_at)
);

create or replace function public.capture_financial_person_participation_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.financial_people set
    financial_tracking_started_at=coalesce(financial_tracking_started_at,new.financial_participation_started_at),
    financial_tracking_start_year=coalesce(financial_tracking_start_year,extract(year from new.financial_participation_started_at at time zone 'America/Fortaleza')::integer),
    financial_tracking_start_month=coalesce(financial_tracking_start_month,extract(month from new.financial_participation_started_at at time zone 'America/Fortaleza')::integer),
    financial_tracking_started_by=coalesce(financial_tracking_started_by,auth.uid()),
    financial_tracking_start_source=coalesce(financial_tracking_start_source,'manual_configuration')
  where id=new.person_id and workspace_id=new.workspace_id;
  return new;
end $$;

drop trigger if exists financial_person_participation_start on public.workspace_financial_memberships;
create trigger financial_person_participation_start after insert on public.workspace_financial_memberships
for each row execute function public.capture_financial_person_participation_start();

alter table public.financial_months
  add column if not exists tracking_started_at timestamptz,
  add column if not exists available_data_start_at timestamptz,
  add column if not exists is_first_financial_report boolean not null default false,
  add column if not exists is_partial_initial_month boolean not null default false,
  add column if not exists report_origin text not null default 'live_tracked' check (report_origin in ('live_tracked','historically_reconstructed'));

alter table public.monthly_financial_reports
  add column if not exists tracking_started_at timestamptz,
  add column if not exists available_data_start_at timestamptz,
  add column if not exists is_first_financial_report boolean not null default false,
  add column if not exists is_partial_initial_month boolean not null default false,
  add column if not exists report_origin text not null default 'live_tracked' check (report_origin in ('live_tracked','historically_reconstructed'));

create or replace function public.set_financial_tracking_start(
  p_user_id uuid,
  p_started_at timestamptz,
  p_source text,
  p_started_by uuid default null
) returns void language plpgsql security definer set search_path='' as $$
declare local_year integer; local_month integer;
begin
  if auth.uid() is not null and auth.uid()<>p_user_id and not public.is_super_admin() then
    raise exception 'Você não pode alterar o início financeiro de outra pessoa.' using errcode='42501';
  end if;
  if p_started_at is null or p_source not in ('finance_module_activation','first_account_connection','manual_configuration','migration') then
    raise exception 'Início do acompanhamento financeiro inválido.' using errcode='22023';
  end if;
  select extract(year from p_started_at at time zone 'America/Fortaleza')::integer,
         extract(month from p_started_at at time zone 'America/Fortaleza')::integer
    into local_year,local_month;
  update public.profiles set
    financial_tracking_started_at=p_started_at,
    financial_tracking_start_year=local_year,
    financial_tracking_start_month=local_month,
    financial_tracking_started_by=coalesce(p_started_by,p_user_id),
    financial_tracking_start_source=p_source
  where id=p_user_id and not exists(
    select 1 from public.monthly_financial_reports report
    join public.financial_months month on month.id=report.financial_month_id
    join public.workspaces workspace on workspace.id=month.workspace_id
    where workspace.owner_id=p_user_id and report.status in ('final','superseded')
  );
end $$;

create or replace function public.capture_finance_module_tracking_start()
returns trigger language plpgsql security definer set search_path='' as $$
declare finance_module_id uuid;
begin
  select id into finance_module_id from public.modules where slug='financeiro';
  if new.module_id=finance_module_id and new.enabled and (tg_op='INSERT' or not coalesce(old.enabled,false)) then
    perform public.set_financial_tracking_start(new.user_id,coalesce(new.enabled_at,now()),'finance_module_activation',coalesce(new.enabled_by,new.user_id));
  end if;
  return new;
end $$;

drop trigger if exists user_module_financial_tracking_start on public.user_modules;
create trigger user_module_financial_tracking_start after insert or update of enabled on public.user_modules
for each row execute function public.capture_finance_module_tracking_start();

create or replace function public.capture_bank_connection_tracking_start()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=new.owner_id and financial_tracking_started_at is not null) then
    perform public.set_financial_tracking_start(new.owner_id,new.created_at,'first_account_connection',new.owner_id);
  end if;
  return new;
end $$;

drop trigger if exists bank_connection_financial_tracking_start on public.bank_connections;
create trigger bank_connection_financial_tracking_start after insert on public.bank_connections
for each row execute function public.capture_bank_connection_tracking_start();

-- Configuração segura do usuário principal já existente. Não cria meses nem
-- reconstrói histórico: apenas define julho/2026 como limite inicial.
update public.profiles profile set
  financial_tracking_started_at='2026-07-01 00:00:00 America/Fortaleza'::timestamptz,
  financial_tracking_start_year=2026,
  financial_tracking_start_month=7,
  financial_tracking_started_by=profile.id,
  financial_tracking_start_source='migration'
where profile.financial_tracking_started_at is null
  and profile.id=(
    select workspace.owner_id from public.workspaces workspace
    where workspace.type='personal' and (
      exists(select 1 from public.financial_accounts account where account.owner_id=workspace.owner_id)
      or exists(select 1 from public.credit_cards card where card.owner_id=workspace.owner_id)
      or exists(select 1 from public.financial_transactions tx where tx.owner_id=workspace.owner_id)
    ) order by workspace.created_at,workspace.id limit 1
  );

update public.financial_months month set
  tracking_started_at=profile.financial_tracking_started_at,
  available_data_start_at=greatest(month.period_start,profile.financial_tracking_started_at),
  is_first_financial_report=(month.reference_year=profile.financial_tracking_start_year and month.reference_month=profile.financial_tracking_start_month),
  is_partial_initial_month=(month.reference_year=profile.financial_tracking_start_year and month.reference_month=profile.financial_tracking_start_month and extract(day from profile.financial_tracking_started_at at time zone month.timezone)>1)
from public.workspaces workspace join public.profiles profile on profile.id=workspace.owner_id
where month.workspace_id=workspace.id and profile.financial_tracking_started_at is not null;

-- Meses vazios anteriores ao início podem ter sido criados pela primeira
-- versão da listagem. Somente registros nunca fechados e sem relatório são removidos.
delete from public.financial_months month using public.workspaces workspace,public.profiles profile
where month.workspace_id=workspace.id and profile.id=workspace.owner_id
  and profile.financial_tracking_started_at is not null
  and make_date(month.reference_year,month.reference_month,1)<make_date(profile.financial_tracking_start_year,profile.financial_tracking_start_month,1)
  and month.current_report_id is null and month.status in ('open','awaiting_consolidation','review');

create or replace function public.copy_financial_tracking_to_report()
returns trigger language plpgsql set search_path='' as $$
declare source_month public.financial_months;
begin
  select * into source_month from public.financial_months where id=new.financial_month_id;
  new.tracking_started_at=source_month.tracking_started_at;
  new.available_data_start_at=source_month.available_data_start_at;
  new.is_first_financial_report=source_month.is_first_financial_report;
  new.is_partial_initial_month=source_month.is_partial_initial_month;
  new.report_origin=source_month.report_origin;
  return new;
end $$;

drop trigger if exists monthly_report_tracking_metadata on public.monthly_financial_reports;
create trigger monthly_report_tracking_metadata before insert on public.monthly_financial_reports
for each row execute function public.copy_financial_tracking_to_report();

alter table public.workspace_financial_memberships enable row level security;
drop policy if exists workspace_financial_memberships_read on public.workspace_financial_memberships;
drop policy if exists workspace_financial_memberships_admin on public.workspace_financial_memberships;
create policy workspace_financial_memberships_read on public.workspace_financial_memberships for select to authenticated
  using (public.can_admin_workspace(workspace_id) or exists(select 1 from public.financial_people person where person.id=person_id and person.user_id=auth.uid()));
create policy workspace_financial_memberships_admin on public.workspace_financial_memberships for all to authenticated
  using (public.can_admin_workspace(workspace_id)) with check (public.can_admin_workspace(workspace_id));

create or replace function public.can_read_workspace_financial_history(target_workspace uuid,target_period timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspaces workspace where workspace.id=target_workspace and workspace.owner_id=auth.uid())
  or exists(
    select 1 from public.workspace_financial_memberships membership
    join public.financial_people person on person.id=membership.person_id
    where membership.workspace_id=target_workspace and person.user_id=auth.uid()
      and membership.include_in_shared_reports
      and (membership.can_view_previous_reports or target_period>=membership.financial_participation_started_at)
      and (membership.financial_participation_ended_at is null or target_period<membership.financial_participation_ended_at)
  )
$$;

drop policy if exists financial_months_read on public.financial_months;
create policy financial_months_read on public.financial_months for select to authenticated
  using (public.can_read_workspace_financial_history(financial_months.workspace_id,financial_months.period_start));
drop policy if exists financial_months_create on public.financial_months;
create policy financial_months_create on public.financial_months for insert to authenticated
  with check (public.can_admin_workspace(workspace_id));

drop policy if exists monthly_reports_read on public.monthly_financial_reports;
create policy monthly_reports_read on public.monthly_financial_reports for select to authenticated using (
  exists(select 1 from public.financial_months month where month.id=monthly_financial_reports.financial_month_id
    and public.can_read_workspace_financial_history(month.workspace_id,month.period_start))
);

drop policy if exists monthly_issues_read on public.monthly_report_issues;
create policy monthly_issues_read on public.monthly_report_issues for select to authenticated using (
  exists(select 1 from public.financial_months month where month.id=monthly_report_issues.financial_month_id
    and public.can_read_workspace_financial_history(month.workspace_id,month.period_start))
);

drop policy if exists monthly_audit_read on public.monthly_report_audit_logs;
create policy monthly_audit_read on public.monthly_report_audit_logs for select to authenticated using (
  exists(select 1 from public.financial_months month where month.id=monthly_report_audit_logs.financial_month_id
    and public.can_read_workspace_financial_history(month.workspace_id,month.period_start))
);

drop policy if exists financial_reports_select on storage.objects;
create policy financial_reports_select on storage.objects for select to authenticated using (
  bucket_id='financial-reports' and exists(
    select 1 from public.monthly_financial_reports report
    join public.financial_months month on month.id=report.financial_month_id
    where report.pdf_storage_path=storage.objects.name
      and public.can_read_workspace_financial_history(month.workspace_id,month.period_start)
  )
);

drop trigger if exists workspace_financial_memberships_set_updated_at on public.workspace_financial_memberships;
create trigger workspace_financial_memberships_set_updated_at before update on public.workspace_financial_memberships
for each row execute function public.set_updated_at();
grant select,insert,update,delete on public.workspace_financial_memberships to authenticated;
revoke all on function public.can_read_workspace_financial_history(uuid,timestamptz) from public,anon;
grant execute on function public.can_read_workspace_financial_history(uuid,timestamptz) to authenticated;
revoke all on function public.set_financial_tracking_start(uuid,timestamptz,text,uuid) from public,anon;
grant execute on function public.set_financial_tracking_start(uuid,timestamptz,text,uuid) to authenticated;

commit;
