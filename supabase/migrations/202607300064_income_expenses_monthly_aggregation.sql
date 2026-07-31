begin;

alter table public.financial_commitments
  add column if not exists estimation_method text not null default 'fixed',
  add column if not exists aggregation_mode text not null default 'single_occurrence',
  add column if not exists expected_date_rule text not null default 'fixed_day',
  add column if not exists expected_date_day integer,
  add column if not exists historical_window_months integer not null default 12,
  add column if not exists historical_median_amount numeric(15,2),
  add column if not exists historical_average_amount numeric(15,2),
  add column if not exists historical_months_count integer not null default 0,
  add column if not exists conservative_planning_amount numeric(15,2),
  add column if not exists source_fingerprint text,
  add column if not exists source_fingerprint_data jsonb not null default '{}'::jsonb,
  add column if not exists income_irregular boolean not null default false,
  add column if not exists include_zero_months boolean not null default true,
  add column if not exists planning_enabled boolean not null default true;

alter table public.financial_commitments
  drop constraint if exists financial_commitments_estimation_method_check,
  add constraint financial_commitments_estimation_method_check
    check (estimation_method in ('fixed','historical_median','manual')),
  drop constraint if exists financial_commitments_aggregation_mode_check,
  add constraint financial_commitments_aggregation_mode_check
    check (aggregation_mode in ('single_occurrence','monthly_total')),
  drop constraint if exists financial_commitments_expected_date_rule_check,
  add constraint financial_commitments_expected_date_rule_check
    check (expected_date_rule in (
      'fixed_day',
      'first_business_day',
      'fifth_business_day',
      'last_business_day',
      'unspecified_in_month'
    )),
  drop constraint if exists financial_commitments_expected_date_day_check,
  add constraint financial_commitments_expected_date_day_check
    check (expected_date_day is null or expected_date_day between 1 and 31),
  drop constraint if exists financial_commitments_historical_window_check,
  add constraint financial_commitments_historical_window_check
    check (historical_window_months between 1 and 12),
  drop constraint if exists financial_commitments_historical_amounts_check,
  add constraint financial_commitments_historical_amounts_check
    check (
      (historical_median_amount is null or historical_median_amount >= 0)
      and (historical_average_amount is null or historical_average_amount >= 0)
      and historical_months_count >= 0
      and (
        conservative_planning_amount is null
        or conservative_planning_amount >= 0
      )
    );

update public.financial_commitments
set
  estimation_method = case
    when amount_type = 'fixed' then 'fixed'
    else 'manual'
  end,
  aggregation_mode = 'single_occurrence',
  expected_date_rule = case
    when due_day is null then 'unspecified_in_month'
    else 'fixed_day'
  end,
  expected_date_day = due_day
where estimation_method = 'fixed'
  and aggregation_mode = 'single_occurrence'
  and source_fingerprint is null;

alter table public.financial_commitment_occurrences
  add column if not exists expected_amount_source text not null default 'fixed_definition',
  add column if not exists received_amount numeric(15,2) not null default 0,
  add column if not exists paid_amount numeric(15,2) not null default 0,
  add column if not exists linked_transactions_count integer not null default 0,
  add column if not exists manual_override_amount numeric(15,2),
  add column if not exists realized_at timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.financial_commitment_occurrences
  drop constraint if exists financial_commitment_occurrences_expected_source_check,
  add constraint financial_commitment_occurrences_expected_source_check
    check (expected_amount_source in (
      'historical_median',
      'fixed_definition',
      'manual_override',
      'system_fallback'
    )),
  drop constraint if exists financial_commitment_occurrences_flow_amounts_check,
  add constraint financial_commitment_occurrences_flow_amounts_check
    check (
      received_amount >= 0
      and paid_amount >= 0
      and linked_transactions_count >= 0
      and (manual_override_amount is null or manual_override_amount >= 0)
    );

alter table public.financial_commitment_occurrences
  drop constraint if exists financial_commitment_occurrences_status_check;
alter table public.financial_commitment_occurrences
  add constraint financial_commitment_occurrences_status_check
    check (status in (
      'projected',
      'expected',
      'pending',
      'paid',
      'partially_paid',
      'overdue',
      'skipped',
      'cancelled',
      'disputed',
      'received',
      'partially_received',
      'above_expected',
      'below_expected'
    ));

update public.financial_commitment_occurrences occurrence
set
  received_amount = case
    when commitment.cash_flow_direction = 'income'
      then coalesce(occurrence.actual_amount, 0)
    else 0
  end,
  paid_amount = case
    when commitment.cash_flow_direction = 'expense'
      then coalesce(occurrence.actual_amount, 0)
    else 0
  end,
  linked_transactions_count = case
    when occurrence.linked_transaction_id is null then 0
    else 1
  end,
  realized_at = case
    when occurrence.payment_date is null then null
    else occurrence.payment_date::timestamptz
  end
from public.financial_commitments commitment
where commitment.id = occurrence.commitment_id;

create table if not exists public.financial_occurrence_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  occurrence_id uuid not null
    references public.financial_commitment_occurrences(id) on delete cascade,
  transaction_id uuid not null
    references public.financial_transactions(id) on delete cascade,
  allocated_amount numeric(15,2) not null check (allocated_amount > 0),
  link_source text not null default 'manual'
    check (link_source in ('manual','historical_backfill','automatic_sync','legacy')),
  confidence numeric(5,4) not null default 1
    check (confidence between 0 and 1),
  manually_confirmed boolean not null default false,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (occurrence_id, transaction_id),
  unique (transaction_id)
);

insert into public.financial_occurrence_transactions (
  workspace_id,
  occurrence_id,
  transaction_id,
  allocated_amount,
  link_source,
  confidence,
  manually_confirmed,
  created_by,
  created_at
)
select
  occurrence.workspace_id,
  occurrence.id,
  occurrence.linked_transaction_id,
  abs(coalesce(occurrence.actual_amount, transaction.amount)),
  'legacy',
  coalesce(occurrence.match_confidence, 1),
  occurrence.manually_confirmed,
  occurrence.created_by,
  occurrence.created_at
from public.financial_commitment_occurrences occurrence
join public.financial_transactions transaction
  on transaction.id = occurrence.linked_transaction_id
where occurrence.linked_transaction_id is not null
on conflict (transaction_id) do nothing;

create index if not exists financial_occurrence_transactions_occurrence_idx
  on public.financial_occurrence_transactions(workspace_id, occurrence_id);
create index if not exists financial_commitments_income_source_idx
  on public.financial_commitments(workspace_id, source_fingerprint)
  where cash_flow_direction = 'income'
    and status = 'active'
    and source_fingerprint is not null;

create or replace function public.validate_financial_occurrence_transaction_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  occurrence_workspace uuid;
  transaction_workspace uuid;
  transaction_owner uuid;
begin
  select occurrence.workspace_id
  into occurrence_workspace
  from public.financial_commitment_occurrences occurrence
  where occurrence.id = new.occurrence_id;

  select transaction.workspace_id, transaction.owner_id
  into transaction_workspace, transaction_owner
  from public.financial_transactions transaction
  where transaction.id = new.transaction_id;

  if occurrence_workspace is null
    or occurrence_workspace <> new.workspace_id
    or (
      transaction_workspace is distinct from new.workspace_id
      and not (
        transaction_workspace is null
        and transaction_owner = auth.uid()
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'financial_occurrence_transaction_scope_mismatch';
  end if;

  -- Chamadas autenticadas continuam obrigadas pela RLS a usar o próprio uid.
  -- A sincronização agendada usa Service Role e preserva o owner já validado.
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;

drop trigger if exists financial_occurrence_transactions_validate_scope
  on public.financial_occurrence_transactions;
create trigger financial_occurrence_transactions_validate_scope
before insert or update on public.financial_occurrence_transactions
for each row execute function
  public.validate_financial_occurrence_transaction_scope();

alter table public.financial_occurrence_transactions enable row level security;

drop policy if exists financial_occurrence_transactions_read
  on public.financial_occurrence_transactions;
create policy financial_occurrence_transactions_read
on public.financial_occurrence_transactions
for select to authenticated
using (
  exists (
    select 1
    from public.financial_commitment_occurrences occurrence
    join public.financial_commitments commitment
      on commitment.id = occurrence.commitment_id
    where occurrence.id = occurrence_id
      and public.can_read_finance(
        commitment.created_by,
        commitment.workspace_id,
        commitment.visibility
      )
  )
);

drop policy if exists financial_occurrence_transactions_write
  on public.financial_occurrence_transactions;
create policy financial_occurrence_transactions_write
on public.financial_occurrence_transactions
for all to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1
    from public.financial_commitment_occurrences occurrence
    join public.financial_commitments commitment
      on commitment.id = occurrence.commitment_id
    where occurrence.id = occurrence_id
      and public.can_write_finance(
        commitment.created_by,
        commitment.workspace_id,
        commitment.visibility
      )
  )
)
with check (
  created_by = auth.uid()
  and public.can_edit_workspace(workspace_id)
);

grant select, insert, update, delete
  on public.financial_occurrence_transactions to authenticated;

commit;
