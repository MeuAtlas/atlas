begin;

alter table public.financial_transactions
  add column if not exists provider_account_id text;

create index if not exists financial_transactions_provider_account_idx
  on public.financial_transactions(bank_connection_id, provider_account_id, competence_date desc)
  where source = 'pluggy';

notify pgrst, 'reload schema';
commit;
