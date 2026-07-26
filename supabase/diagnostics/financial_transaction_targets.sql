-- Aggregate-only diagnostics for transaction target validation.
-- This query intentionally exposes no descriptions, amounts or external IDs.
select
  count(*) filter (
    where (source_type = 'bank' or financial_origin = 'bank_account' or transaction_role = 'cash_flow')
      and account_id is null
  ) as bank_transactions_without_account,
  count(*) filter (
    where (source_type = 'card' or financial_origin = 'credit_card')
      and credit_card_id is null
  ) as card_transactions_without_card,
  count(*) filter (
    where (transaction_role = 'invoice_payment' or financial_origin = 'invoice')
      and (account_id is null or (credit_card_id is null and invoice_id is null))
  ) as invoice_payments_without_links,
  count(*) filter (
    where (transaction_role = 'transfer' or transaction_type = 'transfer')
      and (account_id is null or destination_account_id is null or account_id = destination_account_id)
  ) as transfers_without_valid_destination,
  count(*) filter (
    where review_status = 'pending'
  ) as pending_review
from public.financial_transactions;
