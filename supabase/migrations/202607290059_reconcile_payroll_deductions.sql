-- Desconto em folha não produz uma saída bancária separada. A ocorrência é
-- confirmada pelo crédito de salário da mesma competência e nunca deve ficar
-- atrasada enquanto aguarda o processamento da folha.

create or replace function public.is_realized_salary_transaction(
  target public.financial_transactions
)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    target.status = 'realized'
    and target.bank_direction = 'inflow'
    and (
      target.financial_nature = 'salary'
      or lower(target.description) like '%salário%'
      or lower(target.description) like '%salario%'
    );
$$;

create or replace function public.prepare_payroll_deduction_occurrence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_commitment public.financial_commitments%rowtype;
  salary_date date;
begin
  select *
  into target_commitment
  from public.financial_commitments
  where id = new.commitment_id;

  if not found
    or (
      target_commitment.commitment_type <> 'payroll_deduction'
      and not target_commitment.is_payroll_deduction
    )
    or new.status in ('skipped', 'cancelled', 'disputed')
  then
    return new;
  end if;

  select max(transaction.competence_date)
  into salary_date
  from public.financial_transactions transaction
  where public.is_realized_salary_transaction(transaction)
    and date_trunc('month', transaction.competence_date)::date =
      new.competence_month
    and transaction.owner_id = target_commitment.created_by
    and (
      transaction.workspace_id = target_commitment.workspace_id
      or transaction.workspace_id is null
    );

  if salary_date is not null then
    new.status := 'paid';
    new.actual_amount := new.expected_amount;
    new.payment_date := salary_date;
    new.linked_transaction_id := null;
    new.match_source := 'payroll_salary_received';
    new.match_confidence := 1;
    new.manually_confirmed := false;
  elsif new.status = 'overdue' then
    new.status := 'expected';
    new.actual_amount := null;
    new.payment_date := null;
    new.match_source := 'payroll_awaiting_salary';
    new.match_confidence := null;
    new.manually_confirmed := false;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_payroll_deduction_occurrence
  on public.financial_commitment_occurrences;
create trigger prepare_payroll_deduction_occurrence
before insert or update of
  competence_month,
  expected_amount,
  status
on public.financial_commitment_occurrences
for each row execute function public.prepare_payroll_deduction_occurrence();

create or replace function public.reconcile_payroll_deductions_from_salary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_realized_salary_transaction(new) then
    return new;
  end if;

  with paid_occurrences as (
    update public.financial_commitment_occurrences occurrence
    set
      status = 'paid',
      actual_amount = occurrence.expected_amount,
      payment_date = new.competence_date,
      linked_transaction_id = null,
      match_source = 'payroll_salary_received',
      match_confidence = 1,
      manually_confirmed = false,
      updated_at = now()
    from public.financial_commitments commitment
    where occurrence.commitment_id = commitment.id
      and occurrence.workspace_id = commitment.workspace_id
      and commitment.status = 'active'
      and commitment.created_by = new.owner_id
      and (
        commitment.commitment_type = 'payroll_deduction'
        or commitment.is_payroll_deduction
      )
      and (
        new.workspace_id = commitment.workspace_id
        or new.workspace_id is null
      )
      and occurrence.competence_month =
        date_trunc('month', new.competence_date)::date
      and occurrence.status not in ('paid', 'skipped', 'cancelled', 'disputed')
    returning occurrence.commitment_id
  )
  update public.financial_commitments commitment
  set
    next_due_date = (
      select occurrence.expected_due_date
      from public.financial_commitment_occurrences occurrence
      where occurrence.commitment_id = commitment.id
        and occurrence.workspace_id = commitment.workspace_id
        and occurrence.status in (
          'projected',
          'expected',
          'pending',
          'overdue',
          'partially_paid'
        )
      order by occurrence.expected_due_date
      limit 1
    ),
    updated_at = now()
  where commitment.id in (
    select distinct commitment_id from paid_occurrences
  );

  return new;
end;
$$;

drop trigger if exists reconcile_payroll_deductions_from_salary
  on public.financial_transactions;
create trigger reconcile_payroll_deductions_from_salary
after insert or update of
  status,
  bank_direction,
  financial_nature,
  description,
  competence_date
on public.financial_transactions
for each row execute function public.reconcile_payroll_deductions_from_salary();

-- Corrige ocorrências existentes, inclusive a pensão já cadastrada.
update public.financial_commitment_occurrences occurrence
set
  status = 'expected',
  actual_amount = null,
  payment_date = null,
  match_source = 'payroll_awaiting_salary',
  match_confidence = null,
  manually_confirmed = false,
  updated_at = now()
from public.financial_commitments commitment
where occurrence.commitment_id = commitment.id
  and (
    commitment.commitment_type = 'payroll_deduction'
    or commitment.is_payroll_deduction
  )
  and occurrence.status = 'overdue'
  and occurrence.linked_transaction_id is null
  and occurrence.linked_card_movement_id is null;

with salary_by_month as (
  select
    transaction.owner_id,
    transaction.workspace_id,
    date_trunc('month', transaction.competence_date)::date as competence_month,
    max(transaction.competence_date) as salary_date
  from public.financial_transactions transaction
  where public.is_realized_salary_transaction(transaction)
  group by
    transaction.owner_id,
    transaction.workspace_id,
    date_trunc('month', transaction.competence_date)::date
),
paid_occurrences as (
  update public.financial_commitment_occurrences occurrence
  set
    status = 'paid',
    actual_amount = occurrence.expected_amount,
    payment_date = salary.salary_date,
    linked_transaction_id = null,
    match_source = 'payroll_salary_received',
    match_confidence = 1,
    manually_confirmed = false,
    updated_at = now()
  from public.financial_commitments commitment,
    salary_by_month salary
  where occurrence.commitment_id = commitment.id
    and occurrence.workspace_id = commitment.workspace_id
    and commitment.created_by = salary.owner_id
    and (
      salary.workspace_id = commitment.workspace_id
      or salary.workspace_id is null
    )
    and (
      commitment.commitment_type = 'payroll_deduction'
      or commitment.is_payroll_deduction
    )
    and occurrence.competence_month = salary.competence_month
    and occurrence.status not in ('paid', 'skipped', 'cancelled', 'disputed')
  returning occurrence.commitment_id
)
update public.financial_commitments commitment
set
  next_due_date = (
    select occurrence.expected_due_date
    from public.financial_commitment_occurrences occurrence
    where occurrence.commitment_id = commitment.id
      and occurrence.workspace_id = commitment.workspace_id
      and occurrence.status in (
        'projected',
        'expected',
        'pending',
        'overdue',
        'partially_paid'
      )
    order by occurrence.expected_due_date
    limit 1
  ),
  updated_at = now()
where commitment.id in (
  select distinct commitment_id from paid_occurrences
);
