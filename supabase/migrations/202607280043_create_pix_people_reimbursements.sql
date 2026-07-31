begin;

-- Identificadores de contraparte nunca armazenam CPF, chave Pix ou conta completos.
create table if not exists public.person_counterparties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  provider text,
  counterparty_type text not null check (counterparty_type in (
    'pix_key','tax_number','bank_account','provider_counterparty',
    'normalized_name','composite','other'
  )),
  display_name text,
  normalized_name text,
  tax_number_hash text,
  masked_tax_number text,
  pix_key_hash text,
  masked_pix_key text,
  bank_code text,
  bank_name text,
  branch_masked text,
  account_masked text,
  provider_counterparty_id text,
  direction_scope text not null default 'both'
    check (direction_scope in ('both','incoming_only','outgoing_only')),
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  match_priority integer not null default 100 check (match_priority between 1 and 1000),
  manually_confirmed boolean not null default true,
  reimbursement_match_mode text not null default 'suggest'
    check (reimbursement_match_mode in (
      'suggest','never','exact_amount','explicit_commitment'
    )),
  reimbursement_commitment_id uuid references public.financial_commitments(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (
    counterparty_type = 'other'
    or provider_counterparty_id is not null
    or tax_number_hash is not null
    or pix_key_hash is not null
    or normalized_name is not null
    or (bank_code is not null and account_masked is not null)
  )
);

create table if not exists public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null check (source_type in (
    'bank_transaction','card_movement','invoice_entry',
    'commitment_occurrence','manual_expense'
  )),
  source_transaction_id uuid references public.financial_transactions(id) on delete cascade,
  source_card_movement_id uuid references public.card_purchases(id) on delete cascade,
  source_invoice_entry_id uuid references public.invoice_entries(id) on delete cascade,
  source_commitment_occurrence_id uuid references public.financial_commitment_occurrences(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  allocation_role text not null check (allocation_role in (
    'beneficiary','responsible_party','payer','shared_responsibility'
  )),
  allocation_type text not null check (allocation_type in (
    'full','percentage','fixed_amount','remainder'
  )),
  allocation_value numeric(15,4) not null check (allocation_value >= 0),
  allocated_amount numeric(15,2) not null check (allocated_amount >= 0),
  reimbursable_amount numeric(15,2) not null default 0 check (reimbursable_amount >= 0),
  reimbursed_amount numeric(15,2) not null default 0 check (reimbursed_amount >= 0),
  pending_reimbursement_amount numeric(15,2) not null default 0
    check (pending_reimbursement_amount >= 0),
  status text not null default 'active' check (status in (
    'active','fully_reimbursed','partially_reimbursed','pending',
    'cancelled','disputed'
  )),
  manually_confirmed boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (reimbursable_amount <= allocated_amount),
  check (
    (source_type = 'bank_transaction' and source_transaction_id is not null
      and source_card_movement_id is null and source_invoice_entry_id is null
      and source_commitment_occurrence_id is null)
    or
    (source_type = 'card_movement' and source_transaction_id is null
      and source_card_movement_id is not null and source_invoice_entry_id is null
      and source_commitment_occurrence_id is null)
    or
    (source_type = 'invoice_entry' and source_transaction_id is null
      and source_card_movement_id is null and source_invoice_entry_id is not null
      and source_commitment_occurrence_id is null)
    or
    (source_type = 'commitment_occurrence' and source_transaction_id is null
      and source_card_movement_id is null and source_invoice_entry_id is null
      and source_commitment_occurrence_id is not null)
    or
    (source_type = 'manual_expense' and source_transaction_id is null
      and source_card_movement_id is null and source_invoice_entry_id is null
      and source_commitment_occurrence_id is null)
  )
);

create table if not exists public.financial_reimbursements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  incoming_transaction_id uuid references public.financial_transactions(id) on delete cascade,
  incoming_card_credit_id uuid references public.card_purchases(id) on delete cascade,
  reimbursement_type text not null check (reimbursement_type in (
    'expense_reimbursement','advance_return','shared_expense_contribution',
    'refund','repayment','other'
  )),
  amount numeric(15,2) not null check (amount > 0),
  currency_code char(3) not null default 'BRL',
  received_date date not null,
  status text not null default 'unallocated' check (status in (
    'unallocated','partially_allocated','fully_allocated','cancelled','disputed'
  )),
  source text not null check (source in (
    'pix_auto_match','manual','movement_action','commitment_match','system_suggestion'
  )),
  notes text check (notes is null or char_length(notes) <= 1000),
  manually_confirmed boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (
    (incoming_transaction_id is not null and incoming_card_credit_id is null)
    or (incoming_transaction_id is null and incoming_card_credit_id is not null)
    or (incoming_transaction_id is null and incoming_card_credit_id is null)
  )
);

create table if not exists public.reimbursement_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  reimbursement_id uuid not null references public.financial_reimbursements(id) on delete cascade,
  expense_allocation_id uuid not null references public.expense_allocations(id) on delete cascade,
  allocated_amount numeric(15,2) not null check (allocated_amount > 0),
  allocation_order integer not null default 1 check (allocation_order > 0),
  manually_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reimbursement_id, expense_allocation_id)
);

create table if not exists public.person_transaction_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  person_id uuid not null references public.financial_people(id) on delete cascade,
  counterparty_id uuid references public.person_counterparties(id) on delete set null,
  suggestion_type text not null check (suggestion_type in (
    'person_link','reimbursement_link','outgoing_person_payment',
    'incoming_person_payment','shared_expense_match'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  suggested_role text,
  suggested_expense_allocation_id uuid references public.expense_allocations(id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending','accepted','rejected','expired','auto_applied'
  )),
  reason_metadata jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

alter table public.financial_transactions
  add column if not exists person_flow_role text,
  add column if not exists income_effect text not null default 'normal',
  add column if not exists reimbursement_role text;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_person_flow_role_check,
  add constraint financial_transactions_person_flow_role_check
    check (person_flow_role is null or person_flow_role in (
      'sent_to_person','received_from_person','reimbursement_received','advance_to_person'
    )),
  drop constraint if exists financial_transactions_income_effect_check,
  add constraint financial_transactions_income_effect_check
    check (income_effect in ('normal','neutral')),
  drop constraint if exists financial_transactions_reimbursement_role_check,
  add constraint financial_transactions_reimbursement_role_check
    check (reimbursement_role is null or reimbursement_role in (
      'reimbursement','advance','common_transfer','unclassified'
    ));

alter table public.financial_commitments
  add column if not exists shared_expense_enabled boolean not null default false,
  add column if not exists beneficiary_person_id uuid references public.financial_people(id) on delete set null,
  add column if not exists user_responsibility_type text,
  add column if not exists user_responsibility_value numeric(15,4),
  add column if not exists reimbursement_person_id uuid references public.financial_people(id) on delete set null,
  add column if not exists reimbursement_allocation_type text,
  add column if not exists reimbursement_allocation_value numeric(15,4);

alter table public.financial_commitments
  drop constraint if exists financial_commitments_shared_rules_check,
  add constraint financial_commitments_shared_rules_check check (
    not shared_expense_enabled
    or (
      beneficiary_person_id is not null
      and reimbursement_person_id is not null
      and user_responsibility_type in ('full','percentage','fixed_amount')
      and reimbursement_allocation_type in ('full','percentage','fixed_amount','remainder')
      and user_responsibility_value >= 0
      and reimbursement_allocation_value >= 0
    )
  );

alter table public.commitment_people
  drop constraint if exists commitment_people_allocation_type_check,
  drop constraint if exists commitment_people_check,
  drop constraint if exists commitment_people_allocation_value_check;
alter table public.commitment_people
  add constraint commitment_people_allocation_type_check
    check (allocation_type in ('percentage','fixed_amount','full','remainder')),
  add constraint commitment_people_allocation_value_check check (
    (allocation_type = 'percentage' and allocation_value <= 100)
    or (allocation_type = 'full' and allocation_value = 100)
    or (allocation_type = 'remainder' and allocation_value = 0)
    or allocation_type = 'fixed_amount'
  );

create unique index if not exists financial_people_one_self_per_workspace_idx
  on public.financial_people(workspace_id)
  where relation_type = 'self' and archived_at is null;
create unique index if not exists person_counterparties_identity_idx
  on public.person_counterparties (
    workspace_id, person_id, counterparty_type,
    coalesce(provider_counterparty_id,''),
    coalesce(tax_number_hash,''),
    coalesce(pix_key_hash,''),
    coalesce(bank_code,''),
    coalesce(account_masked,''),
    coalesce(normalized_name,'')
  ) where archived_at is null;
create index if not exists person_counterparties_workspace_idx on public.person_counterparties(workspace_id);
create index if not exists person_counterparties_person_idx on public.person_counterparties(person_id);
create index if not exists person_counterparties_provider_id_idx
  on public.person_counterparties(workspace_id, provider_counterparty_id)
  where provider_counterparty_id is not null and is_active and archived_at is null;
create index if not exists person_counterparties_tax_hash_idx
  on public.person_counterparties(workspace_id, tax_number_hash)
  where tax_number_hash is not null and is_active and archived_at is null;
create index if not exists person_counterparties_pix_hash_idx
  on public.person_counterparties(workspace_id, pix_key_hash)
  where pix_key_hash is not null and is_active and archived_at is null;
create index if not exists person_counterparties_name_idx
  on public.person_counterparties(workspace_id, normalized_name)
  where normalized_name is not null and is_active and archived_at is null;
create index if not exists expense_allocations_workspace_person_idx
  on public.expense_allocations(workspace_id, person_id, status);
create index if not exists expense_allocations_transaction_idx
  on public.expense_allocations(source_transaction_id) where source_transaction_id is not null;
create index if not exists expense_allocations_card_idx
  on public.expense_allocations(source_card_movement_id) where source_card_movement_id is not null;
create index if not exists expense_allocations_occurrence_idx
  on public.expense_allocations(source_commitment_occurrence_id)
  where source_commitment_occurrence_id is not null;
create unique index if not exists expense_allocations_source_person_role_idx
  on public.expense_allocations (
    workspace_id, source_type,
    coalesce(source_transaction_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_card_movement_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_invoice_entry_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_commitment_occurrence_id, '00000000-0000-0000-0000-000000000000'::uuid),
    person_id, allocation_role
  ) where archived_at is null and source_type <> 'manual_expense';
create index if not exists financial_reimbursements_workspace_person_idx
  on public.financial_reimbursements(workspace_id, person_id, status, received_date desc);
create unique index if not exists financial_reimbursements_incoming_transaction_idx
  on public.financial_reimbursements(incoming_transaction_id)
  where incoming_transaction_id is not null and archived_at is null;
create unique index if not exists financial_reimbursements_incoming_card_credit_idx
  on public.financial_reimbursements(incoming_card_credit_id)
  where incoming_card_credit_id is not null and archived_at is null;
create index if not exists reimbursement_allocations_reimbursement_idx
  on public.reimbursement_allocations(reimbursement_id);
create index if not exists reimbursement_allocations_expense_idx
  on public.reimbursement_allocations(expense_allocation_id);
create unique index if not exists person_match_suggestion_pending_idx
  on public.person_transaction_match_suggestions(
    transaction_id, person_id, suggestion_type,
    coalesce(suggested_expense_allocation_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where status = 'pending';

alter table public.financial_people disable trigger financial_people_validate_scope;

insert into public.financial_people (
  workspace_id, created_by, name, relation_type, is_dependent,
  is_active, visibility, notes
)
select w.id, w.owner_id, 'Eu', 'self', false, true, 'workspace',
  'Pessoa criada automaticamente para divisões de responsabilidade.'
from public.workspaces w
where not exists (
  select 1 from public.financial_people p
  where p.workspace_id = w.id and p.relation_type = 'self' and p.archived_at is null
)
on conflict do nothing;

alter table public.financial_people enable trigger financial_people_validate_scope;

create or replace function public.validate_person_reimbursement_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  person_workspace uuid;
  source_workspace uuid;
  source_owner uuid;
  source_visibility text;
  source_direction text;
  reimbursement_workspace uuid;
  allocation_workspace uuid;
begin
  if tg_table_name = 'reimbursement_allocations' then
    select workspace_id into reimbursement_workspace
      from public.financial_reimbursements where id = new.reimbursement_id;
    select workspace_id into allocation_workspace
      from public.expense_allocations where id = new.expense_allocation_id;
    if reimbursement_workspace is null or allocation_workspace is null
      or reimbursement_workspace <> new.workspace_id
      or allocation_workspace <> new.workspace_id then
      raise exception 'reimbursement allocation workspace mismatch';
    end if;
    return new;
  end if;

  select workspace_id into person_workspace
    from public.financial_people where id = new.person_id and archived_at is null;
  if person_workspace is null or person_workspace <> new.workspace_id then
    raise exception 'person workspace mismatch';
  end if;
  if (tg_op = 'INSERT' and new.created_by <> auth.uid())
    or not public.can_edit_workspace(new.workspace_id) then
    raise exception 'person finance write access denied';
  end if;

  if tg_table_name = 'expense_allocations' then
    if new.source_transaction_id is not null then
      select workspace_id, owner_id, visibility into
        source_workspace, source_owner, source_visibility
      from public.financial_transactions where id = new.source_transaction_id;
    elsif new.source_card_movement_id is not null then
      select workspace_id, owner_id, visibility into
        source_workspace, source_owner, source_visibility
      from public.card_purchases where id = new.source_card_movement_id;
    elsif new.source_commitment_occurrence_id is not null then
      select workspace_id into source_workspace
      from public.financial_commitment_occurrences
      where id = new.source_commitment_occurrence_id;
    end if;
    if new.source_type <> 'manual_expense'
      and source_workspace is distinct from new.workspace_id
      and not (source_workspace is null and source_owner = auth.uid()) then
      raise exception 'expense source workspace mismatch';
    end if;
  elsif tg_table_name = 'financial_reimbursements'
    and new.incoming_transaction_id is not null then
    select workspace_id, owner_id, visibility, bank_direction into
      source_workspace, source_owner, source_visibility, source_direction
    from public.financial_transactions where id = new.incoming_transaction_id;
    if (source_workspace is distinct from new.workspace_id
        and not (source_workspace is null and source_owner = auth.uid()))
      or source_direction <> 'inflow' then
      raise exception 'reimbursement requires an incoming transaction in the workspace';
    end if;
  end if;
  return new;
end $$;

create or replace function public.validate_reimbursement_allocation_amount()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  reimbursement_total numeric(15,2);
  reimbursement_used numeric(15,2);
  expense_limit numeric(15,2);
  expense_used numeric(15,2);
begin
  select amount into reimbursement_total
  from public.financial_reimbursements
  where id = new.reimbursement_id for update;
  select reimbursable_amount into expense_limit
  from public.expense_allocations
  where id = new.expense_allocation_id for update;
  select coalesce(sum(allocated_amount),0) into reimbursement_used
  from public.reimbursement_allocations
  where reimbursement_id = new.reimbursement_id and id <> new.id;
  select coalesce(sum(allocated_amount),0) into expense_used
  from public.reimbursement_allocations
  where expense_allocation_id = new.expense_allocation_id and id <> new.id;
  if reimbursement_used + new.allocated_amount > reimbursement_total then
    raise exception 'reimbursement allocation exceeds reimbursement amount';
  end if;
  if expense_used + new.allocated_amount > expense_limit
    and not new.manually_confirmed then
    raise exception 'reimbursement allocation exceeds reimbursable amount';
  end if;
  return new;
end $$;

create or replace function public.refresh_reimbursement_totals()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  reimbursement_target uuid := coalesce(new.reimbursement_id, old.reimbursement_id);
  expense_target uuid := coalesce(new.expense_allocation_id, old.expense_allocation_id);
begin
  update public.expense_allocations expense
  set reimbursed_amount = totals.amount,
      pending_reimbursement_amount = greatest(expense.reimbursable_amount - totals.amount, 0),
      status = case
        when expense.status in ('cancelled','disputed') then expense.status
        when totals.amount <= 0 and expense.reimbursable_amount > 0 then 'pending'
        when totals.amount < expense.reimbursable_amount then 'partially_reimbursed'
        else 'fully_reimbursed'
      end
  from (
    select expense_target as id, coalesce(sum(allocated_amount),0) as amount
    from public.reimbursement_allocations
    where expense_allocation_id = expense_target
  ) totals
  where expense.id = totals.id;

  update public.financial_reimbursements reimbursement
  set status = case
    when reimbursement.status in ('cancelled','disputed') then reimbursement.status
    when totals.amount <= 0 then 'unallocated'
    when totals.amount < reimbursement.amount then 'partially_allocated'
    else 'fully_allocated'
  end
  from (
    select reimbursement_target as id, coalesce(sum(allocated_amount),0) as amount
    from public.reimbursement_allocations
    where reimbursement_id = reimbursement_target
  ) totals
  where reimbursement.id = totals.id;
  return coalesce(new, old);
end $$;

create or replace function public.create_shared_occurrence_allocations()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  commitment_row public.financial_commitments%rowtype;
  self_person_id uuid;
  gross numeric(15,2);
  user_amount numeric(15,2);
  other_amount numeric(15,2);
begin
  select * into commitment_row from public.financial_commitments
  where id = new.commitment_id;
  if not commitment_row.shared_expense_enabled then return new; end if;
  select id into self_person_id from public.financial_people
  where workspace_id = new.workspace_id and relation_type = 'self'
    and archived_at is null limit 1;
  if self_person_id is null then return new; end if;
  gross := coalesce(new.actual_amount, new.expected_amount, commitment_row.expected_amount, 0);
  user_amount := case commitment_row.user_responsibility_type
    when 'full' then gross
    when 'percentage' then round(gross * commitment_row.user_responsibility_value / 100, 2)
    else least(commitment_row.user_responsibility_value, gross)
  end;
  other_amount := case commitment_row.reimbursement_allocation_type
    when 'full' then gross
    when 'percentage' then round(gross * commitment_row.reimbursement_allocation_value / 100, 2)
    when 'fixed_amount' then least(commitment_row.reimbursement_allocation_value, gross)
    else greatest(gross - user_amount, 0)
  end;

  insert into public.expense_allocations (
    workspace_id, source_type, source_commitment_occurrence_id, person_id,
    allocation_role, allocation_type, allocation_value, allocated_amount,
    reimbursable_amount, pending_reimbursement_amount, status,
    manually_confirmed, created_by
  ) values
  (new.workspace_id, 'commitment_occurrence', new.id,
    commitment_row.beneficiary_person_id, 'beneficiary', 'full', 100,
    gross, 0, 0, 'active', true, new.created_by),
  (new.workspace_id, 'commitment_occurrence', new.id,
    self_person_id, 'responsible_party',
    commitment_row.user_responsibility_type,
    commitment_row.user_responsibility_value, user_amount, 0, 0,
    'active', true, new.created_by),
  (new.workspace_id, 'commitment_occurrence', new.id,
    commitment_row.reimbursement_person_id, 'shared_responsibility',
    commitment_row.reimbursement_allocation_type,
    commitment_row.reimbursement_allocation_value, other_amount, other_amount,
    other_amount, case when other_amount > 0 then 'pending' else 'active' end,
    true, new.created_by)
  on conflict do nothing;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'person_counterparties','expense_allocations','financial_reimbursements',
    'reimbursement_allocations'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

create trigger person_counterparties_validate_scope
before insert or update on public.person_counterparties
for each row execute function public.validate_person_reimbursement_scope();
create trigger expense_allocations_validate_scope
before insert or update on public.expense_allocations
for each row execute function public.validate_person_reimbursement_scope();
create trigger financial_reimbursements_validate_scope
before insert or update on public.financial_reimbursements
for each row execute function public.validate_person_reimbursement_scope();
create trigger reimbursement_allocations_validate_scope
before insert or update on public.reimbursement_allocations
for each row execute function public.validate_person_reimbursement_scope();
create trigger reimbursement_allocations_validate_amount
before insert or update on public.reimbursement_allocations
for each row execute function public.validate_reimbursement_allocation_amount();
create trigger reimbursement_allocations_refresh_totals
after insert or update or delete on public.reimbursement_allocations
for each row execute function public.refresh_reimbursement_totals();
create trigger shared_occurrence_create_allocations
after insert on public.financial_commitment_occurrences
for each row execute function public.create_shared_occurrence_allocations();

do $$ declare t text; begin
  foreach t in array array[
    'person_counterparties','expense_allocations','financial_reimbursements',
    'reimbursement_allocations','person_transaction_match_suggestions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_read on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (public.can_edit_workspace(workspace_id))',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.can_edit_workspace(workspace_id))',
      t, t
    );
  end loop;
end $$;

grant select, insert, update, delete on
  public.person_counterparties,
  public.expense_allocations,
  public.financial_reimbursements,
  public.reimbursement_allocations,
  public.person_transaction_match_suggestions
to authenticated;

commit;
