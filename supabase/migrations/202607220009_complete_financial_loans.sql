-- Complete loan support without creating fictitious bank-account movements.
alter table public.bank_connections
  add column if not exists loans_sync_status text not null default 'pending'
    check (loans_sync_status in ('pending','available','empty','unavailable','error')),
  add column if not exists loans_sync_message text,
  add column if not exists last_loans_sync_at timestamptz;

alter table public.financial_loans
  add column if not exists subtype text,
  add column if not exists contracted_amount numeric(15,2),
  add column if not exists outstanding_balance numeric(15,2),
  add column if not exists installment_amount numeric(15,2),
  add column if not exists installment_count integer,
  add column if not exists installments_paid integer,
  add column if not exists installments_remaining integer,
  add column if not exists effective_cost_rate numeric(12,6),
  add column if not exists contract_date date,
  add column if not exists first_installment_date date,
  add column if not exists final_due_date date,
  add column if not exists payroll_deducted boolean,
  add column if not exists payment_source text check (payment_source in ('bank_account','payroll','other')),
  add column if not exists provider_updated_at timestamptz,
  add column if not exists raw_metadata jsonb not null default '{}'::jsonb,
  add column if not exists notes text;

alter table public.financial_loans alter column original_amount drop not null;
alter table public.financial_loans alter column original_amount drop default;
alter table public.financial_loans alter column balance_due drop not null;
alter table public.financial_loans alter column balance_due drop default;
alter table public.financial_loans alter column interest_rate drop not null;
alter table public.financial_loans alter column interest_rate drop default;

update public.financial_loans
set contracted_amount = coalesce(contracted_amount, nullif(original_amount, 0)),
    outstanding_balance = coalesce(outstanding_balance, nullif(balance_due, 0)),
    installment_count = coalesce(installment_count, installments),
    contract_date = coalesce(contract_date, start_date),
    final_due_date = coalesce(final_due_date, end_date),
    payment_source = case when payroll_deducted is true then 'payroll' else payment_source end
where source <> 'pluggy' or contracted_amount is null or outstanding_balance is null;

alter table public.financial_transactions
  add column if not exists loan_id uuid references public.financial_loans(id) on delete cascade,
  add column if not exists payment_source text check (payment_source in ('bank_account','payroll','other')),
  add column if not exists installment_number integer check (installment_number is null or installment_number > 0);

do $$ declare constraint_name text; begin
 for constraint_name in
  select conname from pg_constraint
  where conrelid='public.financial_transactions'::regclass and contype='c'
    and pg_get_constraintdef(oid) ilike '%source%'
 loop execute format('alter table public.financial_transactions drop constraint %I',constraint_name); end loop;
end $$;
alter table public.financial_transactions add constraint financial_transactions_source_check
  check(source in ('manual','pluggy','ofx','csv','recurrence','card','automation','pluggy_loan','manual_loan'));

alter table public.financial_transactions drop constraint if exists financial_transactions_target_check;
alter table public.financial_transactions add constraint financial_transactions_target_check
  check(account_id is not null or credit_card_id is not null or loan_id is not null);

create or replace function public.validate_financial_transaction_accounts()
returns trigger language plpgsql security invoker set search_path=''
as $$ declare account_owner uuid; account_workspace uuid; account_visibility text; loan_owner uuid; begin
 if new.owner_id<>auth.uid() then raise exception 'invalid transaction owner'; end if;
 if new.account_id is not null then
  select owner_id,workspace_id,visibility into account_owner,account_workspace,account_visibility from public.financial_accounts where id=new.account_id;
  if account_owner is null or not public.can_write_finance(account_owner,account_workspace,account_visibility) then raise exception 'account access denied'; end if;
 elsif new.loan_id is not null then
  select owner_id into loan_owner from public.financial_loans where id=new.loan_id;
  if loan_owner is null or loan_owner<>auth.uid() then raise exception 'loan access denied'; end if;
  if new.payment_source='payroll' and new.account_id is not null then raise exception 'payroll transaction cannot affect bank account'; end if;
 else raise exception 'financial target required';
 end if;
 if new.destination_account_id is not null then
  select owner_id,workspace_id,visibility into account_owner,account_workspace,account_visibility from public.financial_accounts where id=new.destination_account_id;
  if account_owner is null or not public.can_write_finance(account_owner,account_workspace,account_visibility) then raise exception 'destination account access denied'; end if;
 end if;
 return new;
end $$;

create index if not exists financial_transactions_loan on public.financial_transactions(loan_id, competence_date);
create index if not exists financial_loans_owner_status on public.financial_loans(owner_id, status);

