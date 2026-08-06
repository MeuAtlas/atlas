-- A variable expense has a reference amount for planning only. Once a payment
-- is linked to its monthly occurrence, that occurrence is fully paid.
create or replace function public.recalculate_financial_occurrence_payments(
  p_occurrence_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.financial_commitment_occurrences%rowtype;
  is_variable_amount boolean := false;
  total_paid numeric(15,2);
  payment_count integer;
  last_payment_date date;
  first_transaction_id uuid;
  restored_status text;
  today_in_brasilia date := timezone('America/Sao_Paulo', now())::date;
begin
  select occurrence.*, coalesce(commitment.amount_type = 'variable', false)
    into target, is_variable_amount
  from public.financial_commitment_occurrences occurrence
  join public.financial_commitments commitment on commitment.id = occurrence.commitment_id
  where occurrence.id = p_occurrence_id
  for update of occurrence;

  if target.id is null then return; end if;

  select
    coalesce(sum(link.allocated_amount), 0),
    count(*)::integer,
    max(transaction.competence_date),
    (array_agg(
      transaction.id
      order by transaction.competence_date, link.created_at, transaction.id
    ))[1]
  into total_paid, payment_count, last_payment_date, first_transaction_id
  from public.financial_occurrence_transactions link
  join public.financial_transactions transaction on transaction.id = link.transaction_id
  where link.occurrence_id = target.id;

  restored_status := case
    when target.status in ('cancelled','skipped','disputed') then target.status
    when total_paid > 0 and (
      is_variable_amount
      or total_paid >= coalesce(target.expected_amount, 0) - 0.01
    ) then 'paid'
    when total_paid > 0 then 'partially_paid'
    when target.expected_due_date < today_in_brasilia then 'overdue'
    when target.expected_due_date is not null
      and date_trunc('month', target.expected_due_date)
        = date_trunc('month', today_in_brasilia) then 'pending'
    else 'projected'
  end;

  update public.financial_commitment_occurrences occurrence
  set
    linked_transaction_id = first_transaction_id,
    actual_amount = case when payment_count = 0 then null else total_paid end,
    paid_amount = total_paid,
    linked_transactions_count = payment_count,
    payment_date = last_payment_date,
    status = restored_status,
    manually_confirmed = payment_count > 0,
    match_source = case
      when payment_count = 0 then null
      when payment_count = 1 then 'manual'
      else 'multiple_payments'
    end,
    match_confidence = case when payment_count = 0 then null else 1 end,
    realized_at = last_payment_date::timestamptz,
    updated_at = now()
  where occurrence.id = target.id;
end;
$$;

do $$
declare
  occurrence record;
begin
  for occurrence in
    select distinct o.id
    from public.financial_commitment_occurrences o
    join public.financial_commitments c on c.id = o.commitment_id
    join public.financial_occurrence_transactions link on link.occurrence_id = o.id
    where c.amount_type = 'variable'
  loop
    perform public.recalculate_financial_occurrence_payments(occurrence.id);
  end loop;
end;
$$;
