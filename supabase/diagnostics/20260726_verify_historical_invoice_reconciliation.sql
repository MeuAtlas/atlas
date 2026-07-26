-- Safe post-migration verification. IDs are masked and no secret is returned.

select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_invoices'
      and column_name = 'confirmed_invoice_total'
  ) as has_confirmed_invoice_total,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'card_invoices'
      and column_name = 'invoice_breakdown'
  ) as has_invoice_breakdown,
  to_regprocedure(
    'public.reconcile_historical_invoice_payments()'
  ) is not null as has_reconciliation_function;

select
  coalesce(
    payment.realized_at::date,
    payment.bank_posted_at::date,
    payment.competence_date
  ) as payment_date,
  payment.amount,
  payment.original_amount,
  payment.status,
  payment.source_type,
  payment.transaction_type,
  payment.transaction_role,
  payment.bank_direction,
  payment.financial_nature,
  account.institution_name as paying_institution,
  account.name as paying_account,
  left(payment.id::text, 4) || '…' || right(payment.id::text, 4)
    as masked_payment_id,
  case when payment.invoice_id is null then null
    else left(payment.invoice_id::text, 4) || '…'
      || right(payment.invoice_id::text, 4)
  end as masked_invoice_id
from public.financial_transactions payment
left join public.financial_accounts account on account.id = payment.account_id
where abs(payment.amount) = 11517.22
  and coalesce(
    payment.realized_at::date,
    payment.bank_posted_at::date,
    payment.competence_date
  ) between date '2026-07-03' and date '2026-07-10'
  and payment.description ilike '%PAGAMENTO%CART%';

select public.reconcile_historical_invoice_payments()
  as second_idempotency_run;

select
  invoice.reference_month,
  invoice.cycle_start_date,
  invoice.cycle_end_date,
  invoice.closing_date,
  invoice.due_date,
  invoice.status,
  invoice.confirmed_invoice_total,
  invoice.calculated_invoice_total,
  invoice.paid_amount,
  invoice.reconciliation_difference,
  invoice.reconciliation_status,
  invoice.total_source,
  left(invoice.id::text, 4) || '…' || right(invoice.id::text, 4)
    as masked_invoice_id
from public.card_invoices invoice
join public.credit_cards card on card.id = invoice.card_id
where card.last_four_digits = '5718'
  and invoice.closing_date = date '2026-07-03';

select
  coalesce(payment.realized_at::date, payment.competence_date)
    as payment_date,
  payment.amount,
  payment.bank_direction,
  payment.transaction_role,
  payment.financial_nature,
  payment.financial_role,
  account.institution_name as paying_institution,
  account.name as paying_account,
  left(payment.id::text, 4) || '…' || right(payment.id::text, 4)
    as masked_payment_id,
  left(payment.invoice_id::text, 4) || '…'
    || right(payment.invoice_id::text, 4) as masked_invoice_id,
  left(payment.account_id::text, 4) || '…'
    || right(payment.account_id::text, 4) as masked_account_id
from public.financial_transactions payment
left join public.financial_accounts account on account.id = payment.account_id
where payment.invoice_id in (
  select invoice.id
  from public.card_invoices invoice
  join public.credit_cards card on card.id = invoice.card_id
  where card.last_four_digits = '5718'
    and invoice.closing_date = date '2026-07-03'
)
  and payment.transaction_role = 'invoice_payment';

select
  count(*) as linked_payment_count,
  count(distinct payment.id) as distinct_payment_count
from public.financial_transactions payment
where payment.invoice_id in (
  select invoice.id
  from public.card_invoices invoice
  join public.credit_cards card on card.id = invoice.card_id
  where card.last_four_digits = '5718'
    and invoice.closing_date = date '2026-07-03'
)
  and payment.transaction_role = 'invoice_payment';
