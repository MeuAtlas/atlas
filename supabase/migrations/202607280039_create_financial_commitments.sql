-- Pessoas, compromissos, ocorrências e matching financeiro.
create table if not exists public.financial_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  relation_type text not null check (relation_type in ('self','child','spouse','parent','dependent','family','other')),
  is_dependent boolean not null default false,
  is_active boolean not null default true,
  visibility text not null default 'private' check (visibility in ('private','workspace')),
  color_key text,
  notes text check (notes is null or char_length(notes) <= 1000),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.financial_commitments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'private' check (visibility in ('private','workspace')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text,
  commitment_type text not null check (commitment_type in ('recurring','one_time','installment','subscription','payroll_deduction','manual','other')),
  recurrence_frequency text check (recurrence_frequency is null or recurrence_frequency in ('weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual','custom')),
  recurrence_interval integer check (recurrence_interval is null or recurrence_interval between 1 and 120),
  amount_type text not null check (amount_type in ('fixed','variable','estimated')),
  expected_amount numeric(15,2) check (expected_amount is null or expected_amount >= 0),
  minimum_expected_amount numeric(15,2) check (minimum_expected_amount is null or minimum_expected_amount >= 0),
  maximum_expected_amount numeric(15,2) check (maximum_expected_amount is null or maximum_expected_amount >= 0),
  currency_code char(3) not null default 'BRL',
  category_id uuid references public.financial_categories(id) on delete set null,
  account_id uuid references public.financial_accounts(id) on delete set null,
  card_id uuid references public.credit_cards(id) on delete set null,
  payment_method text check (payment_method is null or payment_method in ('bank_debit','credit_card','payroll','pix','boleto','cash','transfer','other')),
  due_day integer check (due_day is null or due_day between 1 and 31),
  due_date date,
  start_date date not null,
  end_date date,
  next_due_date date,
  status text not null default 'active' check (status in ('active','paused','completed','cancelled','archived')),
  auto_match_enabled boolean not null default true,
  merchant_match_pattern text,
  description_match_pattern text,
  expected_day_tolerance integer not null default 5 check (expected_day_tolerance between 0 and 45),
  expected_amount_tolerance numeric(15,2) check (expected_amount_tolerance is null or expected_amount_tolerance >= 0),
  source text not null default 'manual' check (source in ('manual','movement','pluggy_suggestion','card_installment','loan','pdf','system')),
  source_record_id uuid,
  is_payroll_deduction boolean not null default false,
  generates_future_projections boolean not null default true,
  last_generated_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (end_date is null or end_date >= start_date),
  check (maximum_expected_amount is null or minimum_expected_amount is null or maximum_expected_amount >= minimum_expected_amount),
  check (
    commitment_type in ('one_time','manual','other')
    or recurrence_frequency is not null
  )
);

create table if not exists public.financial_commitment_occurrences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  commitment_id uuid not null references public.financial_commitments(id) on delete cascade,
  competence_month date not null check (extract(day from competence_month) = 1),
  sequence_number integer not null default 1 check (sequence_number > 0),
  expected_due_date date,
  expected_amount numeric(15,2) check (expected_amount is null or expected_amount >= 0),
  actual_amount numeric(15,2) check (actual_amount is null or actual_amount >= 0),
  currency_code char(3) not null default 'BRL',
  status text not null default 'projected' check (status in ('projected','expected','pending','paid','partially_paid','overdue','skipped','cancelled','disputed')),
  payment_date date,
  linked_transaction_id uuid references public.financial_transactions(id) on delete set null,
  linked_card_movement_id uuid references public.card_purchases(id) on delete set null,
  linked_invoice_id uuid references public.card_invoices(id) on delete set null,
  linked_document_id uuid references public.invoice_documents(id) on delete set null,
  match_confidence numeric(5,4) check (match_confidence is null or match_confidence between 0 and 1),
  match_source text,
  manually_confirmed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (commitment_id, competence_month, sequence_number)
);

create unique index if not exists commitment_occurrence_transaction_unique
  on public.financial_commitment_occurrences(linked_transaction_id)
  where linked_transaction_id is not null;
create unique index if not exists commitment_occurrence_card_movement_unique
  on public.financial_commitment_occurrences(linked_card_movement_id)
  where linked_card_movement_id is not null;

create table if not exists public.commitment_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  commitment_id uuid not null references public.financial_commitments(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  allocation_type text not null check (allocation_type in ('percentage','fixed_amount','full')),
  allocation_value numeric(15,4) not null check (allocation_value >= 0),
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (commitment_id, person_id),
  check (
    (allocation_type = 'percentage' and allocation_value <= 100)
    or (allocation_type = 'full' and allocation_value = 100)
    or allocation_type = 'fixed_amount'
  )
);

create table if not exists public.transaction_people (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  allocation_type text not null check (allocation_type in ('percentage','fixed_amount','full')),
  allocation_value numeric(15,4) not null check (allocation_value >= 0),
  source text not null default 'manual' check (source in ('manual','commitment','rule','suggestion')),
  manually_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, person_id),
  check (
    (allocation_type = 'percentage' and allocation_value <= 100)
    or (allocation_type = 'full' and allocation_value = 100)
    or allocation_type = 'fixed_amount'
  )
);

create table if not exists public.commitment_match_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  commitment_id uuid not null references public.financial_commitments(id) on delete cascade,
  match_field text not null check (match_field in ('description','merchant','category','provider_category','amount','account','card')),
  match_operator text not null check (match_operator in ('contains','equals','starts_with','regex','range')),
  match_value text not null,
  account_id uuid references public.financial_accounts(id) on delete cascade,
  card_id uuid references public.credit_cards(id) on delete cascade,
  amount_min numeric(15,2),
  amount_max numeric(15,2),
  day_tolerance integer check (day_tolerance is null or day_tolerance between 0 and 45),
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commitment_match_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  commitment_id uuid references public.financial_commitments(id) on delete cascade,
  transaction_id uuid references public.financial_transactions(id) on delete cascade,
  card_movement_id uuid references public.card_purchases(id) on delete cascade,
  fingerprint text not null,
  decision text not null check (decision in ('confirmed','rejected')),
  created_at timestamptz not null default now(),
  unique (workspace_id, fingerprint)
);

create index if not exists financial_people_workspace_active_idx
  on public.financial_people(workspace_id, is_active) where archived_at is null;
create index if not exists financial_commitments_workspace_status_idx
  on public.financial_commitments(workspace_id, status) where archived_at is null;
create index if not exists financial_commitments_next_due_idx
  on public.financial_commitments(workspace_id, next_due_date) where status = 'active';
create index if not exists financial_commitments_category_idx on public.financial_commitments(category_id);
create index if not exists financial_commitments_account_idx on public.financial_commitments(account_id);
create index if not exists financial_commitments_card_idx on public.financial_commitments(card_id);
create index if not exists commitment_occurrences_month_status_idx
  on public.financial_commitment_occurrences(workspace_id, competence_month, status);
create index if not exists commitment_occurrences_due_idx
  on public.financial_commitment_occurrences(workspace_id, expected_due_date, status);
create index if not exists transaction_people_transaction_idx on public.transaction_people(transaction_id);
create index if not exists transaction_people_person_idx on public.transaction_people(person_id);
create index if not exists commitment_people_person_idx on public.commitment_people(person_id);
create index if not exists commitment_match_rules_commitment_idx
  on public.commitment_match_rules(commitment_id, is_active, priority);

do $$ declare t text; begin
  foreach t in array array[
    'financial_people',
    'financial_commitments',
    'financial_commitment_occurrences',
    'commitment_people',
    'transaction_people',
    'commitment_match_rules'
  ] loop
    if not exists (
      select 1 from pg_trigger
      where tgname = t || '_set_updated_at'
    ) then
      execute format(
        'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
        t, t
      );
    end if;
  end loop;
end $$;

create or replace function public.validate_commitment_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare parent_workspace uuid;
begin
  if new.created_by <> auth.uid() then
    raise exception 'invalid commitment owner';
  end if;
  if not public.can_write_finance(new.created_by, new.workspace_id, 'workspace') then
    raise exception 'commitment workspace access denied';
  end if;
  if tg_table_name in ('financial_commitment_occurrences','commitment_people','commitment_match_rules') then
    select workspace_id into parent_workspace
    from public.financial_commitments where id = new.commitment_id;
    if parent_workspace is null or parent_workspace <> new.workspace_id then
      raise exception 'commitment workspace mismatch';
    end if;
  end if;
  return new;
end $$;

create or replace function public.validate_transaction_person_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare transaction_workspace uuid; transaction_owner uuid; transaction_visibility text;
begin
  select workspace_id, owner_id, visibility
    into transaction_workspace, transaction_owner, transaction_visibility
  from public.financial_transactions where id = new.transaction_id;
  if transaction_owner is null
    or not public.can_write_finance(transaction_owner, transaction_workspace, transaction_visibility)
    or new.created_by <> auth.uid()
    or new.workspace_id is distinct from coalesce(transaction_workspace, new.workspace_id)
  then raise exception 'transaction allocation access denied';
  end if;
  return new;
end $$;

drop trigger if exists financial_people_validate_scope on public.financial_people;
create trigger financial_people_validate_scope before insert or update on public.financial_people
for each row execute function public.validate_commitment_scope();
drop trigger if exists financial_commitments_validate_scope on public.financial_commitments;
create trigger financial_commitments_validate_scope before insert or update on public.financial_commitments
for each row execute function public.validate_commitment_scope();
drop trigger if exists financial_commitment_occurrences_validate_scope on public.financial_commitment_occurrences;
create trigger financial_commitment_occurrences_validate_scope before insert or update on public.financial_commitment_occurrences
for each row execute function public.validate_commitment_scope();
drop trigger if exists commitment_people_validate_scope on public.commitment_people;
create trigger commitment_people_validate_scope before insert or update on public.commitment_people
for each row execute function public.validate_commitment_scope();
drop trigger if exists commitment_match_rules_validate_scope on public.commitment_match_rules;
create trigger commitment_match_rules_validate_scope before insert or update on public.commitment_match_rules
for each row execute function public.validate_commitment_scope();
drop trigger if exists transaction_people_validate_scope on public.transaction_people;
create trigger transaction_people_validate_scope before insert or update on public.transaction_people
for each row execute function public.validate_transaction_person_scope();

do $$ declare t text; begin
  foreach t in array array[
    'financial_people','financial_commitments','financial_commitment_occurrences',
    'commitment_people','transaction_people','commitment_match_rules',
    'commitment_match_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create policy financial_people_read on public.financial_people for select to authenticated
using (created_by = auth.uid() or (visibility = 'workspace' and public.is_workspace_member(workspace_id)));
create policy financial_people_write on public.financial_people for all to authenticated
using (created_by = auth.uid() or (visibility = 'workspace' and public.can_edit_workspace(workspace_id)))
with check (created_by = auth.uid() and public.can_write_finance(created_by, workspace_id, 'workspace'));

create policy financial_commitments_read on public.financial_commitments for select to authenticated
using (public.can_read_finance(created_by, workspace_id, visibility));
create policy financial_commitments_write on public.financial_commitments for all to authenticated
using (public.can_write_finance(created_by, workspace_id, visibility))
with check (created_by = auth.uid() and public.can_write_finance(created_by, workspace_id, visibility));

create policy commitment_occurrences_read on public.financial_commitment_occurrences for select to authenticated
using (exists (
  select 1 from public.financial_commitments c
  where c.id = commitment_id
    and public.can_read_finance(c.created_by, c.workspace_id, c.visibility)
));
create policy commitment_occurrences_write on public.financial_commitment_occurrences for all to authenticated
using (exists (
  select 1 from public.financial_commitments c
  where c.id = commitment_id
    and public.can_write_finance(c.created_by, c.workspace_id, c.visibility)
))
with check (created_by = auth.uid() and exists (
  select 1 from public.financial_commitments c
  where c.id = commitment_id and c.workspace_id = workspace_id
    and public.can_write_finance(c.created_by, c.workspace_id, c.visibility)
));

create policy commitment_people_read on public.commitment_people for select to authenticated
using (exists (
  select 1 from public.financial_commitments c
  where c.id = commitment_id
    and public.can_read_finance(c.created_by, c.workspace_id, c.visibility)
));
create policy commitment_people_write on public.commitment_people for all to authenticated
using (created_by = auth.uid() or public.can_edit_workspace(workspace_id))
with check (created_by = auth.uid() and public.can_edit_workspace(workspace_id));

create policy transaction_people_read on public.transaction_people for select to authenticated
using (created_by = auth.uid() or public.is_workspace_member(workspace_id));
create policy transaction_people_write on public.transaction_people for all to authenticated
using (created_by = auth.uid() or public.can_edit_workspace(workspace_id))
with check (created_by = auth.uid() and public.can_edit_workspace(workspace_id));

create policy commitment_match_rules_read on public.commitment_match_rules for select to authenticated
using (created_by = auth.uid() or public.is_workspace_member(workspace_id));
create policy commitment_match_rules_write on public.commitment_match_rules for all to authenticated
using (created_by = auth.uid() or public.can_edit_workspace(workspace_id))
with check (created_by = auth.uid() and public.can_edit_workspace(workspace_id));

create policy commitment_match_decisions_owner on public.commitment_match_decisions for all to authenticated
using (created_by = auth.uid()) with check (created_by = auth.uid() and public.can_edit_workspace(workspace_id));

grant select, insert, update, delete on
  public.financial_people,
  public.financial_commitments,
  public.financial_commitment_occurrences,
  public.commitment_people,
  public.transaction_people,
  public.commitment_match_rules,
  public.commitment_match_decisions
to authenticated;
