-- Restore the bank side of invoice payments that migration 010 also copied to
-- card_purchases. Purchases represent consumption; this row represents the
-- physical debit in the checking account and must remain available to cash flow.
do $$
declare
  analyzed_count bigint;
  payment_count bigint;
  ambiguous_count bigint;
  corrected_count bigint;
begin
  select count(*) into analyzed_count
  from public.financial_transactions
  where account_id is not null;

  select count(*) into payment_count
  from public.financial_transactions
  where account_id is not null
    and (
      transaction_role = 'invoice_payment'
      or cash_flow_kind = 'invoice_payment'
      or financial_nature = 'invoice_payment'
    );

  select count(*) into ambiguous_count
  from public.financial_transactions
  where account_id is null
    and (
      transaction_role = 'invoice_payment'
      or cash_flow_kind = 'invoice_payment'
      or financial_nature = 'invoice_payment'
    );

  raise notice
    'invoice payment cash-flow dry-run: analyzed=%, payments=%, ambiguous=%',
    analyzed_count,
    payment_count,
    ambiguous_count;

  update public.financial_transactions
  set source_type = 'bank',
      financial_origin = 'bank_account',
      transaction_role = 'invoice_payment',
      cash_flow_kind = 'invoice_payment',
      bank_direction = 'outflow',
      migrated_card_purchase_id = null
  where account_id is not null
    and (
      transaction_role = 'invoice_payment'
      or cash_flow_kind = 'invoice_payment'
      or financial_nature = 'invoice_payment'
    )
    and (
      source_type is distinct from 'bank'
      or financial_origin is distinct from 'bank_account'
      or transaction_role is distinct from 'invoice_payment'
      or cash_flow_kind is distinct from 'invoice_payment'
      or bank_direction is distinct from 'outflow'
      or migrated_card_purchase_id is not null
    );

  get diagnostics corrected_count = row_count;
  raise notice
    'invoice payment cash-flow backfill: corrected=%, ambiguous=%',
    corrected_count,
    ambiguous_count;
end
$$;

create index if not exists financial_transactions_bank_cash_flow
  on public.financial_transactions(
    owner_id,
    account_id,
    competence_date desc,
    bank_direction
  )
  where account_id is not null
    and status in ('realized','completed','posted','settled','paid','received');
