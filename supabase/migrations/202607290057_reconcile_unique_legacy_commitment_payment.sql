-- Repara compromissos legados criados a partir de uma movimentação antes de a
-- origem ter sido persistida. O vínculo só é feito quando existe um único
-- lançamento com descrição, conta, data, direção e valor exatamente iguais.

with candidate_matches as (
  select
    occurrence.id as occurrence_id,
    commitment.id as commitment_id,
    transaction.id as transaction_id,
    abs(transaction.amount) as actual_amount,
    transaction.competence_date as payment_date,
    count(*) over (partition by occurrence.id) as candidate_count
  from public.financial_commitments commitment
  join public.financial_commitment_occurrences occurrence
    on occurrence.commitment_id = commitment.id
   and occurrence.workspace_id = commitment.workspace_id
  join public.financial_transactions transaction
    on transaction.workspace_id = commitment.workspace_id
   and transaction.account_id is not distinct from commitment.account_id
   and transaction.competence_date = occurrence.expected_due_date
   and abs(transaction.amount) = occurrence.expected_amount
   and transaction.description = commitment.description
   and (
     (commitment.cash_flow_direction = 'expense'
       and transaction.bank_direction = 'outflow')
     or
     (commitment.cash_flow_direction = 'income'
       and transaction.bank_direction = 'inflow')
   )
  where commitment.status = 'active'
    and commitment.archived_at is null
    and commitment.commitment_type in (
      'recurring',
      'subscription',
      'payroll_deduction'
    )
    and (
      commitment.source <> 'movement'
      or commitment.source_record_id is null
    )
    and occurrence.status in (
      'expected',
      'pending',
      'overdue',
      'partially_paid'
    )
    and occurrence.linked_transaction_id is null
    and occurrence.linked_card_movement_id is null
    and not exists (
      select 1
      from public.financial_commitment_occurrences already_linked
      where already_linked.linked_transaction_id = transaction.id
    )
),
unique_matches as (
  select *
  from candidate_matches
  where candidate_count = 1
),
repaired_occurrences as (
  update public.financial_commitment_occurrences occurrence
  set
    linked_transaction_id = source.transaction_id,
    actual_amount = source.actual_amount,
    payment_date = source.payment_date,
    status = 'paid',
    manually_confirmed = true,
    match_source = 'legacy_movement_origin',
    match_confidence = 1,
    updated_at = now()
  from unique_matches source
  where occurrence.id = source.occurrence_id
  returning occurrence.commitment_id
),
repaired_commitments as (
  update public.financial_commitments commitment
  set
    source = 'movement',
    source_record_id = source.transaction_id,
    updated_at = now()
  from unique_matches source
  where commitment.id = source.commitment_id
  returning commitment.id, commitment.workspace_id
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
      and occurrence.linked_transaction_id is null
      and occurrence.linked_card_movement_id is null
    order by occurrence.expected_due_date asc
    limit 1
  ),
  updated_at = now()
where exists (
  select 1
  from repaired_commitments repaired
  where repaired.id = commitment.id
    and repaired.workspace_id = commitment.workspace_id
);
