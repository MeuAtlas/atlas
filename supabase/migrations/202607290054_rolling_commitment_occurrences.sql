begin;

create table if not exists public.financial_commitment_amount_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  commitment_id uuid not null
    references public.financial_commitments(id) on delete cascade,
  occurrence_id uuid
    references public.financial_commitment_occurrences(id) on delete set null,
  effective_from date not null,
  previous_amount numeric(15,2)
    check (previous_amount is null or previous_amount >= 0),
  new_amount numeric(15,2) not null check (new_amount > 0),
  amount_type text not null
    check (amount_type in ('fixed', 'estimated', 'variable')),
  scope text not null
    check (scope in ('single_occurrence', 'from_effective_date')),
  reason text check (reason is null or char_length(reason) <= 240),
  created_at timestamptz not null default now()
);

create index if not exists commitment_amount_revisions_commitment_idx
  on public.financial_commitment_amount_revisions(
    commitment_id,
    effective_from desc
  );

create or replace function public.validate_commitment_amount_revision_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_workspace uuid;
  parent_owner uuid;
  parent_visibility text;
  occurrence_commitment uuid;
begin
  select workspace_id, created_by, visibility
    into parent_workspace, parent_owner, parent_visibility
  from public.financial_commitments
  where id = new.commitment_id;

  if parent_workspace is null
    or parent_workspace <> new.workspace_id
    or not public.can_write_finance(
      parent_owner,
      parent_workspace,
      parent_visibility
    )
  then
    raise exception 'commitment amount revision access denied';
  end if;

  if auth.role() <> 'service_role' and new.created_by <> auth.uid() then
    raise exception 'invalid commitment amount revision owner';
  end if;

  if new.occurrence_id is not null then
    select commitment_id into occurrence_commitment
    from public.financial_commitment_occurrences
    where id = new.occurrence_id;
    if occurrence_commitment is null
      or occurrence_commitment <> new.commitment_id
    then
      raise exception 'commitment amount revision occurrence mismatch';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists financial_commitment_amount_revisions_validate_scope
  on public.financial_commitment_amount_revisions;
create trigger financial_commitment_amount_revisions_validate_scope
before insert or update on public.financial_commitment_amount_revisions
for each row execute function
  public.validate_commitment_amount_revision_scope();

alter table public.financial_commitment_amount_revisions
  enable row level security;

drop policy if exists commitment_amount_revisions_read
  on public.financial_commitment_amount_revisions;
create policy commitment_amount_revisions_read
on public.financial_commitment_amount_revisions
for select to authenticated
using (
  exists (
    select 1
    from public.financial_commitments c
    where c.id = commitment_id
      and public.can_read_finance(
        c.created_by,
        c.workspace_id,
        c.visibility
      )
  )
);

drop policy if exists commitment_amount_revisions_write
  on public.financial_commitment_amount_revisions;
create policy commitment_amount_revisions_write
on public.financial_commitment_amount_revisions
for all to authenticated
using (
  exists (
    select 1
    from public.financial_commitments c
    where c.id = commitment_id
      and public.can_write_finance(
        c.created_by,
        c.workspace_id,
        c.visibility
      )
  )
)
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.financial_commitments c
    where c.id = commitment_id
      and c.workspace_id = workspace_id
      and public.can_write_finance(
        c.created_by,
        c.workspace_id,
        c.visibility
      )
  )
);

grant select, insert on public.financial_commitment_amount_revisions
  to authenticated;
grant select, insert, update, delete
  on public.financial_commitment_amount_revisions
  to service_role;

create or replace function public.complete_financial_commitment(
  target_workspace uuid,
  target_commitment uuid,
  target_date date default current_date
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_owner uuid;
  parent_visibility text;
  parent_start date;
  cancelled_count integer;
begin
  select created_by, visibility, start_date
    into parent_owner, parent_visibility, parent_start
  from public.financial_commitments
  where id = target_commitment
    and workspace_id = target_workspace;

  if parent_owner is null
    or not public.can_write_finance(
      parent_owner,
      target_workspace,
      parent_visibility
    )
  then
    raise exception 'financial commitment access denied';
  end if;

  update public.financial_commitments
  set
    status = 'completed',
    end_date = greatest(target_date, parent_start),
    next_due_date = null
  where id = target_commitment
    and workspace_id = target_workspace;

  update public.financial_commitment_occurrences
  set
    status = 'cancelled',
    cancelled_at = now(),
    manually_confirmed = true
  where workspace_id = target_workspace
    and commitment_id = target_commitment
    and expected_due_date >= target_date
    and status in ('projected', 'expected', 'pending')
    and linked_transaction_id is null
    and linked_card_movement_id is null;

  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end
$$;

create or replace function public.revise_financial_commitment_amount(
  target_workspace uuid,
  target_commitment uuid,
  target_occurrence uuid,
  target_amount numeric,
  target_amount_type text,
  target_scope text,
  target_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_owner uuid;
  parent_visibility text;
  occurrence_due_date date;
  occurrence_previous_amount numeric(15,2);
  occurrence_status text;
  occurrence_transaction uuid;
  occurrence_card_movement uuid;
begin
  if target_amount <= 0
    or target_amount_type not in ('fixed', 'estimated', 'variable')
    or target_scope not in ('single_occurrence', 'from_effective_date')
  then
    raise exception 'invalid commitment amount revision';
  end if;

  select created_by, visibility
    into parent_owner, parent_visibility
  from public.financial_commitments
  where id = target_commitment
    and workspace_id = target_workspace;

  if parent_owner is null
    or not public.can_write_finance(
      parent_owner,
      target_workspace,
      parent_visibility
    )
  then
    raise exception 'financial commitment access denied';
  end if;

  select
    expected_due_date,
    expected_amount,
    status,
    linked_transaction_id,
    linked_card_movement_id
  into
    occurrence_due_date,
    occurrence_previous_amount,
    occurrence_status,
    occurrence_transaction,
    occurrence_card_movement
  from public.financial_commitment_occurrences
  where id = target_occurrence
    and commitment_id = target_commitment
    and workspace_id = target_workspace
  for update;

  if occurrence_due_date is null then
    raise exception 'commitment occurrence not found';
  end if;
  if occurrence_status in (
    'paid',
    'partially_paid',
    'cancelled',
    'skipped'
  )
    or occurrence_transaction is not null
    or occurrence_card_movement is not null
  then
    raise exception 'completed occurrence cannot be revised';
  end if;

  if target_scope = 'single_occurrence' then
    update public.financial_commitment_occurrences
    set
      expected_amount = target_amount,
      manually_confirmed = true
    where id = target_occurrence
      and workspace_id = target_workspace;
  else
    update public.financial_commitments
    set
      expected_amount = target_amount,
      amount_type = target_amount_type
    where id = target_commitment
      and workspace_id = target_workspace;

    update public.financial_commitment_occurrences
    set
      expected_amount = target_amount,
      manually_confirmed = true
    where commitment_id = target_commitment
      and workspace_id = target_workspace
      and expected_due_date >= occurrence_due_date
      and status in ('projected', 'expected', 'pending')
      and linked_transaction_id is null
      and linked_card_movement_id is null;
  end if;

  insert into public.financial_commitment_amount_revisions (
    workspace_id,
    created_by,
    commitment_id,
    occurrence_id,
    effective_from,
    previous_amount,
    new_amount,
    amount_type,
    scope,
    reason
  )
  values (
    target_workspace,
    auth.uid(),
    target_commitment,
    target_occurrence,
    occurrence_due_date,
    occurrence_previous_amount,
    target_amount,
    target_amount_type,
    target_scope,
    nullif(btrim(target_reason), '')
  );
end
$$;

grant execute on function public.complete_financial_commitment(
  uuid,
  uuid,
  date
) to authenticated;
grant execute on function public.revise_financial_commitment_amount(
  uuid,
  uuid,
  uuid,
  numeric,
  text,
  text,
  text
) to authenticated;

-- Recorrências contínuas passam a manter apenas o mês vigente e o seguinte.
-- Ocorrências pagas, vinculadas ou manualmente encerradas são preservadas.
with rolling_horizon as (
  select
    id,
    (
      date_trunc('month', current_date)
      + interval '2 months'
      - interval '1 day'
    )::date as last_day
  from public.financial_commitments
  where commitment_type in (
    'recurring',
    'subscription',
    'payroll_deduction'
  )
)
delete from public.financial_commitment_occurrences occurrence
using rolling_horizon horizon
where occurrence.commitment_id = horizon.id
  and occurrence.expected_due_date > horizon.last_day
  and occurrence.status in ('projected', 'expected', 'pending')
  and occurrence.linked_transaction_id is null
  and occurrence.linked_card_movement_id is null;

commit;
