begin;

alter table public.financial_commitments
  add column if not exists income_basis text,
  add column if not exists cash_flow_effect text,
  add column if not exists planning_effect text,
  add column if not exists analytics_effect text,
  add column if not exists payment_channel text;

alter table public.financial_commitments
  drop constraint if exists financial_commitments_income_basis_check,
  add constraint financial_commitments_income_basis_check
    check (income_basis is null or income_basis in ('net','gross','unknown')),
  drop constraint if exists financial_commitments_cash_flow_effect_check,
  add constraint financial_commitments_cash_flow_effect_check
    check (cash_flow_effect in ('inflow','outflow','none')),
  drop constraint if exists financial_commitments_planning_effect_check,
  add constraint financial_commitments_planning_effect_check
    check (planning_effect in ('increase','decrease','informational','none')),
  drop constraint if exists financial_commitments_analytics_effect_check,
  add constraint financial_commitments_analytics_effect_check
    check (analytics_effect in (
      'income','expense','reimbursement','transfer','informational','none'
    )),
  drop constraint if exists financial_commitments_payment_channel_check,
  add constraint financial_commitments_payment_channel_check
    check (payment_channel in ('bank','card','payroll','manual','other'));

update public.financial_commitments
set
  is_payroll_deduction = true,
  commitment_type = 'payroll_deduction',
  payment_method = 'payroll',
  income_basis = null,
  cash_flow_effect = 'none',
  planning_effect = 'informational',
  analytics_effect = 'expense',
  payment_channel = 'payroll',
  auto_match_enabled = false,
  account_id = null,
  card_id = null,
  updated_at = now()
where coalesce(cash_flow_direction, 'expense') <> 'income'
  and (
    is_payroll_deduction
    or commitment_type = 'payroll_deduction'
    or payment_method = 'payroll'
    or lower(coalesce(title, '')) ~
      '(desconto em folha|pens(ã|a)o.*folha|consignado.*folha|sindicato.*folha|plano.*folha)'
  );

update public.financial_commitments
set
  income_basis = case
    when source in ('movement','pluggy') then 'net'
    else coalesce(income_basis, 'net')
  end,
  cash_flow_effect = 'inflow',
  planning_effect = 'increase',
  analytics_effect = 'income',
  payment_channel = coalesce(payment_channel, 'bank'),
  is_payroll_deduction = false,
  updated_at = now()
where cash_flow_direction = 'income';

update public.financial_commitments
set
  income_basis = null,
  cash_flow_effect = coalesce(cash_flow_effect, 'outflow'),
  planning_effect = coalesce(planning_effect, 'decrease'),
  analytics_effect = coalesce(analytics_effect, 'expense'),
  payment_channel = coalesce(
    payment_channel,
    case
      when payment_method = 'credit_card' then 'card'
      when payment_method in (
        'bank_debit','pix','boleto','transfer'
      ) then 'bank'
      when payment_method = 'cash' then 'manual'
      else 'other'
    end
  ),
  updated_at = now()
where coalesce(cash_flow_direction, 'expense') <> 'income'
  and not is_payroll_deduction;

alter table public.financial_commitments
  alter column cash_flow_effect set default 'outflow',
  alter column cash_flow_effect set not null,
  alter column planning_effect set default 'decrease',
  alter column planning_effect set not null,
  alter column analytics_effect set default 'expense',
  alter column analytics_effect set not null,
  alter column payment_channel set default 'other',
  alter column payment_channel set not null;

alter table public.financial_commitment_occurrences
  add column if not exists cash_effect_amount numeric(15,2) not null default 0,
  add column if not exists analytical_amount numeric(15,2) not null default 0,
  add column if not exists planning_effect_amount numeric(15,2) not null default 0,
  add column if not exists payroll_confirmed_amount numeric(15,2);

alter table public.financial_commitment_occurrences
  drop constraint if exists financial_commitment_occurrences_effect_amounts_check,
  add constraint financial_commitment_occurrences_effect_amounts_check
    check (
      cash_effect_amount >= 0
      and analytical_amount >= 0
      and planning_effect_amount >= 0
      and (
        payroll_confirmed_amount is null
        or payroll_confirmed_amount >= 0
      )
    );

update public.financial_commitment_occurrences occurrence
set
  cash_effect_amount = case
    when commitment.cash_flow_effect = 'none' then 0
    else coalesce(occurrence.actual_amount, 0)
  end,
  analytical_amount = case
    when commitment.analytics_effect in ('income','expense','reimbursement')
      then coalesce(occurrence.actual_amount, occurrence.expected_amount, 0)
    else 0
  end,
  planning_effect_amount = case
    when commitment.planning_effect in ('increase','decrease')
      and occurrence.status not in ('paid','received','cancelled','skipped')
      then greatest(
        coalesce(occurrence.expected_amount, 0) -
          coalesce(occurrence.actual_amount, 0),
        0
      )
    else 0
  end,
  payroll_confirmed_amount = case
    when commitment.is_payroll_deduction
      then occurrence.actual_amount
    else null
  end
from public.financial_commitments commitment
where commitment.id = occurrence.commitment_id;

create or replace function public.resolve_financial_commitment_effects()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.cash_flow_direction = 'income' then
    if new.source in ('movement','pluggy') or new.income_basis is null then
      new.income_basis := 'net';
    end if;
    new.cash_flow_effect := 'inflow';
    new.planning_effect := 'increase';
    new.analytics_effect := 'income';
    new.payment_channel := coalesce(new.payment_channel, 'bank');
    new.is_payroll_deduction := false;
    return new;
  end if;

  if new.is_payroll_deduction
    or new.commitment_type = 'payroll_deduction'
    or new.payment_method = 'payroll'
    or new.payment_channel = 'payroll'
  then
    new.is_payroll_deduction := true;
    new.commitment_type := 'payroll_deduction';
    new.payment_method := 'payroll';
    new.income_basis := null;
    new.cash_flow_effect := 'none';
    new.planning_effect := 'informational';
    new.analytics_effect := 'expense';
    new.payment_channel := 'payroll';
    new.account_id := null;
    new.card_id := null;
    new.auto_match_enabled := false;
    return new;
  end if;

  new.income_basis := null;
  new.cash_flow_effect := coalesce(new.cash_flow_effect, 'outflow');
  new.planning_effect := coalesce(new.planning_effect, 'decrease');
  new.analytics_effect := coalesce(new.analytics_effect, 'expense');
  new.payment_channel := coalesce(new.payment_channel, 'other');
  return new;
end;
$$;

drop trigger if exists financial_commitments_resolve_effects
  on public.financial_commitments;
create trigger financial_commitments_resolve_effects
before insert or update of
  cash_flow_direction,
  commitment_type,
  payment_method,
  payment_channel,
  is_payroll_deduction,
  income_basis,
  cash_flow_effect,
  planning_effect,
  analytics_effect
on public.financial_commitments
for each row execute function public.resolve_financial_commitment_effects();

create or replace function public.resolve_commitment_occurrence_effect_amounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  commitment record;
begin
  select
    item.cash_flow_effect,
    item.planning_effect,
    item.analytics_effect,
    item.is_payroll_deduction
  into commitment
  from public.financial_commitments item
  where item.id = new.commitment_id;

  new.cash_effect_amount := case
    when commitment.cash_flow_effect = 'none' then 0
    else coalesce(new.actual_amount, 0)
  end;
  new.analytical_amount := case
    when commitment.analytics_effect in ('income','expense','reimbursement')
      then coalesce(new.actual_amount, new.expected_amount, 0)
    else 0
  end;
  new.planning_effect_amount := case
    when commitment.planning_effect in ('increase','decrease')
      and new.status not in ('paid','received','cancelled','skipped')
      then greatest(
        coalesce(new.expected_amount, 0) - coalesce(new.actual_amount, 0),
        0
      )
    else 0
  end;
  new.payroll_confirmed_amount := case
    when commitment.is_payroll_deduction then new.actual_amount
    else null
  end;
  return new;
end;
$$;

drop trigger if exists commitment_occurrences_resolve_effect_amounts
  on public.financial_commitment_occurrences;
create trigger commitment_occurrences_resolve_effect_amounts
before insert or update of
  commitment_id,
  expected_amount,
  actual_amount,
  status
on public.financial_commitment_occurrences
for each row execute function
  public.resolve_commitment_occurrence_effect_amounts();

create or replace view public.payroll_deduction_duplicate_diagnostics
with (security_invoker = true)
as
select
  commitment.workspace_id,
  commitment.id as commitment_id,
  commitment.title,
  occurrence.id as occurrence_id,
  occurrence.competence_month,
  occurrence.expected_amount,
  occurrence.actual_amount,
  occurrence.linked_transaction_id,
  transaction.amount as linked_transaction_amount,
  transaction.competence_date as linked_transaction_competence,
  (occurrence.linked_transaction_id is not null) as possible_duplicate
from public.financial_commitments commitment
join public.financial_commitment_occurrences occurrence
  on occurrence.commitment_id = commitment.id
left join public.financial_transactions transaction
  on transaction.id = occurrence.linked_transaction_id
where commitment.is_payroll_deduction;

grant select on public.payroll_deduction_duplicate_diagnostics
  to authenticated;

create index if not exists financial_commitments_effects_idx
  on public.financial_commitments(
    workspace_id,
    cash_flow_effect,
    planning_effect,
    analytics_effect
  )
  where archived_at is null;

commit;
