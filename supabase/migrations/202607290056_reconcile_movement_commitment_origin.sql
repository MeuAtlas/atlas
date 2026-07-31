-- A recorrência criada a partir de uma movimentação deve considerar a própria
-- movimentação como pagamento da ocorrência do mês de origem.

with source_occurrences as (
  select
    occurrence.id as occurrence_id,
    occurrence.commitment_id,
    transaction.id as transaction_id,
    abs(transaction.amount) as actual_amount,
    transaction.competence_date as payment_date
  from public.financial_commitments commitment
  join public.financial_transactions transaction
    on transaction.id = commitment.source_record_id
   and transaction.workspace_id = commitment.workspace_id
  join public.financial_commitment_occurrences occurrence
    on occurrence.commitment_id = commitment.id
   and occurrence.workspace_id = commitment.workspace_id
   and occurrence.competence_month =
     date_trunc('month', transaction.competence_date)::date
  where commitment.source = 'movement'
    and commitment.source_record_id is not null
    and occurrence.linked_transaction_id is null
    and occurrence.linked_card_movement_id is null
    and not exists (
      select 1
      from public.financial_commitment_occurrences already_linked
      where already_linked.linked_transaction_id = transaction.id
        and already_linked.id <> occurrence.id
    )
)
update public.financial_commitment_occurrences occurrence
set
  linked_transaction_id = source.transaction_id,
  actual_amount = source.actual_amount,
  payment_date = source.payment_date,
  status = 'paid',
  manually_confirmed = true,
  match_source = 'movement_origin',
  match_confidence = 1,
  updated_at = now()
from source_occurrences source
where occurrence.id = source.occurrence_id;

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
where commitment.status = 'active'
  and commitment.archived_at is null
  and commitment.source = 'movement';
