-- Keep the provider's official open-invoice total separate from transaction reconciliation.
alter table public.credit_cards
  add column if not exists account_credit_balance numeric(15,2),
  add column if not exists provider_bill_id text,
  add column if not exists provider_bill_closing_date date,
  add column if not exists provider_bill_due_date date,
  add column if not exists provider_cycle_start_date date;

alter table public.credit_cards drop constraint if exists credit_cards_dates_source_check;
alter table public.credit_cards add constraint credit_cards_dates_source_check
  check (dates_source in ('provider_bill','pluggy','manual','estimated'));

-- Before this migration current_balance already represented Account.balance for CREDIT.
update public.credit_cards
set account_credit_balance=abs(current_balance)
where source='pluggy'
  and account_credit_balance is null;

-- Older code populated this field from creditData rather than from a Bill.
update public.credit_cards
set provider_invoice_total=null
where provider_bill_id is null;

alter table public.card_purchases
  add column if not exists provider_bill_id text;

create index if not exists card_purchases_provider_bill
  on public.card_purchases(owner_id,card_id,provider_bill_id)
  where provider_bill_id is not null;

alter table public.card_invoices
  add column if not exists account_credit_balance numeric(15,2),
  add column if not exists pending_transactions_total numeric(15,2) not null default 0,
  add column if not exists unassigned_transactions_total numeric(15,2) not null default 0,
  add column if not exists total_source text not null default 'calculated_transactions';

alter table public.card_invoices drop constraint if exists card_invoices_total_source_check;
alter table public.card_invoices add constraint card_invoices_total_source_check
  check (total_source in ('provider_bill','credit_account_balance','calculated_transactions'));

