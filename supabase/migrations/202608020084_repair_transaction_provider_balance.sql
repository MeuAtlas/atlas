begin;

-- Repara drift de schema em ambientes antigos, nos quais a migration histórica
-- consta como aplicada mas a coluna usada pelo mapper Pluggy não existe mais.
alter table public.financial_transactions
  add column if not exists provider_balance numeric(15,2);

notify pgrst, 'reload schema';

commit;
