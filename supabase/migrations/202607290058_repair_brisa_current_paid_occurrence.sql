-- Correção pontual do compromisso Brisanet confirmado pelo usuário:
-- o acompanhamento começa em julho/2026, julho já foi pago e agosto é a
-- primeira ocorrência futura. As ocorrências anteriores, criadas por uma data
-- inicial incorreta, ficam canceladas para preservar o histórico da correção.

update public.financial_commitment_occurrences
set
  status = 'cancelled',
  cancelled_at = now(),
  manually_confirmed = true,
  match_source = 'manual_correction',
  updated_at = now()
where commitment_id = '6acb4151-035b-4937-ada0-8a8d08a699ae'
  and competence_month < date '2026-07-01'
  and linked_transaction_id is null
  and linked_card_movement_id is null
  and status in ('projected', 'expected', 'pending', 'overdue');

update public.financial_commitment_occurrences
set
  actual_amount = expected_amount,
  payment_date = date '2026-07-10',
  status = 'paid',
  manually_confirmed = true,
  match_source = 'manual_correction',
  match_confidence = 1,
  updated_at = now()
where commitment_id = '6acb4151-035b-4937-ada0-8a8d08a699ae'
  and competence_month = date '2026-07-01'
  and linked_transaction_id is null
  and linked_card_movement_id is null;

update public.financial_commitments
set
  start_date = date '2026-07-10',
  next_due_date = date '2026-08-10',
  updated_at = now()
where id = '6acb4151-035b-4937-ada0-8a8d08a699ae'
  and title = 'Brisanet'
  and expected_amount = 111.38;
