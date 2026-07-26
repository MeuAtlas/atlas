-- Align recognized monthly result with financial competence.
-- This migration only reclassifies existing rows; it does not delete history.

update public.financial_transactions
set transaction_role = 'cash_flow',
    financial_origin = 'bank_account',
    cash_flow_kind = 'transfer_suspected',
    review_status = 'pending'
where suspected_transfer is true
  and transaction_role = 'transfer'
  and cash_flow_kind is distinct from 'invoice_payment';

update public.financial_transactions
set transaction_type = 'expense',
    transaction_role = 'cash_flow',
    financial_origin = 'bank_account',
    cash_flow_kind = 'expense',
    review_status = 'reviewed'
where transaction_role = 'adjustment'
  and lower(coalesce(description, '') || ' ' || coalesce(provider_category, ''))
      ~ '(tarifa|encargo|fee|juros|multa)';

update public.card_purchases
set transaction_role = 'consumption',
    financial_origin = 'credit_card',
    review_status = 'reviewed'
where transaction_role = 'adjustment'
  and lower(coalesce(description, '') || ' ' || coalesce(provider_category, ''))
      ~ '(tarifa|encargo|fee|juros|multa)';

update public.financial_transactions
set transaction_role = 'cash_flow',
    financial_origin = 'bank_account',
    cash_flow_kind = 'loan_proceeds',
    review_status = 'reviewed'
where transaction_type = 'income'
  and lower(coalesce(description, '') || ' ' || coalesce(provider_category, ''))
      ~ '(empréstimo|emprestimo|crédito consignado|credito consignado|loan proceeds|financiamento liberado)';

update public.financial_transactions
set transaction_role = 'adjustment',
    financial_origin = 'adjustment',
    cash_flow_kind = case
      when transaction_type = 'income' then 'investment_redemption'
      else 'investment_contribution'
    end,
    review_status = 'reviewed'
where lower(coalesce(description, '') || ' ' || coalesce(provider_category, ''))
      ~ '(aplicação|aplicacao|aporte|resgate.*invest|investment contribution|investment redemption|transfer.*invest)'
  and lower(coalesce(description, '') || ' ' || coalesce(provider_category, ''))
      !~ '(rendimento|dividendo|juros sobre capital|income distribution)';

update public.financial_transactions
set review_status = 'reviewed'
where transaction_role = 'refund'
  and review_status = 'pending';

create index if not exists financial_transactions_monthly_result
  on public.financial_transactions(owner_id, workspace_id, competence_date, status, transaction_role);

create index if not exists card_purchases_monthly_result
  on public.card_purchases(owner_id, workspace_id, competence_date, status, transaction_role);
