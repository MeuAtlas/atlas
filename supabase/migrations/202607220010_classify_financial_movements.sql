-- Separate bank cash flow from card consumption without deleting imported history.
alter table public.financial_transactions
  add column if not exists source_type text,
  add column if not exists financial_origin text,
  add column if not exists transaction_role text,
  add column if not exists invoice_id uuid references public.card_invoices(id) on delete set null,
  add column if not exists migrated_card_purchase_id uuid references public.card_purchases(id) on delete set null;

alter table public.card_purchases
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists source_type text not null default 'card',
  add column if not exists financial_origin text not null default 'credit_card',
  add column if not exists transaction_role text not null default 'consumption',
  add column if not exists status text not null default 'realized',
  add column if not exists review_status text not null default 'reviewed',
  add column if not exists invoice_reference text,
  add column if not exists bill_forecast_date date,
  add column if not exists provider_category text,
  add column if not exists merchant text,
  add column if not exists currency char(3) not null default 'BRL',
  add column if not exists original_amount numeric(15,2),
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_sync_at timestamptz;

-- The previous trigger only accepted account_id or loan_id. Replace it before
-- reclassifying legacy card rows, because the UPDATE below also fires triggers.
create or replace function public.validate_financial_transaction_accounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  resource_owner uuid;
  resource_workspace uuid;
  resource_visibility text;
  invoice_card_id uuid;
  is_pending_import boolean :=
    new.review_status = 'pending'
    and new.source in ('pluggy', 'ofx', 'csv', 'automation')
    and new.external_id is not null;
begin
  if actor_id is not null and new.owner_id is distinct from actor_id then
    raise exception 'invalid transaction owner';
  end if;

  if new.payment_source = 'payroll' or new.source_type = 'payroll' then
    if new.account_id is not null or new.credit_card_id is not null or new.invoice_id is not null then
      raise exception 'payroll transaction cannot affect bank account or card';
    end if;
    if new.loan_id is null and new.recurring_rule_id is null and not is_pending_import then
      raise exception 'payroll transaction requires loan_id, recurring_rule_id or pending import reference';
    end if;
  elsif (new.transaction_role = 'transfer' or new.transaction_type = 'transfer')
     and new.transaction_role is distinct from 'invoice_payment'
     and new.financial_origin is distinct from 'invoice' then
    if (new.account_id is null or new.destination_account_id is null) and not is_pending_import then
      raise exception 'transfer requires origin and destination accounts';
    end if;
    if new.account_id is not null
       and new.destination_account_id is not null
       and new.account_id = new.destination_account_id then
      raise exception 'transfer requires different origin and destination accounts';
    end if;
  elsif new.transaction_role = 'invoice_payment' or new.financial_origin = 'invoice' then
    if new.account_id is null and not is_pending_import then
      raise exception 'invoice payment requires account_id';
    end if;
    if new.credit_card_id is null and new.invoice_id is null and not is_pending_import then
      raise exception 'invoice payment requires credit_card_id or invoice_id';
    end if;
  elsif new.transaction_role = 'adjustment' then
    if new.account_id is null and new.credit_card_id is null and new.invoice_id is null then
      raise exception 'adjustment requires a financial target';
    end if;
  elsif new.source_type = 'card'
     or new.financial_origin = 'credit_card'
     or (new.transaction_role = 'consumption' and new.financial_origin = 'credit_card') then
    if new.credit_card_id is null and not is_pending_import then
      raise exception 'card transaction requires credit_card_id';
    end if;
  elsif new.transaction_role = 'refund' then
    if new.account_id is null and new.credit_card_id is null and new.invoice_id is null and not is_pending_import then
      raise exception 'refund requires a financial target';
    end if;
  elsif new.source_type = 'bank'
     or new.financial_origin = 'bank_account'
     or new.transaction_role = 'cash_flow' then
    if new.account_id is null and not is_pending_import then
      raise exception 'bank transaction requires account_id';
    end if;
  elsif new.account_id is null
     and new.credit_card_id is null
     and new.invoice_id is null
     and new.loan_id is null
     and new.recurring_rule_id is null
     and not is_pending_import then
    raise exception 'transaction requires a financial target or pending import reference';
  end if;

  if new.account_id is not null then
    select owner_id, workspace_id, visibility
      into resource_owner, resource_workspace, resource_visibility
    from public.financial_accounts
    where id = new.account_id;
    if resource_owner is null
       or resource_owner is distinct from new.owner_id
       or (actor_id is not null and not public.can_write_finance(resource_owner, resource_workspace, resource_visibility)) then
      raise exception 'account access denied';
    end if;
  end if;

  if new.destination_account_id is not null then
    select owner_id, workspace_id, visibility
      into resource_owner, resource_workspace, resource_visibility
    from public.financial_accounts
    where id = new.destination_account_id;
    if resource_owner is null
       or resource_owner is distinct from new.owner_id
       or (actor_id is not null and not public.can_write_finance(resource_owner, resource_workspace, resource_visibility)) then
      raise exception 'destination account access denied';
    end if;
  end if;

  if new.credit_card_id is not null then
    select owner_id, workspace_id, visibility
      into resource_owner, resource_workspace, resource_visibility
    from public.credit_cards
    where id = new.credit_card_id;
    if resource_owner is null
       or resource_owner is distinct from new.owner_id
       or (actor_id is not null and not public.can_write_finance(resource_owner, resource_workspace, resource_visibility)) then
      raise exception 'credit card access denied';
    end if;
  end if;

  if new.invoice_id is not null then
    select owner_id, card_id
      into resource_owner, invoice_card_id
    from public.card_invoices
    where id = new.invoice_id;
    if resource_owner is null or resource_owner is distinct from new.owner_id then
      raise exception 'invoice access denied';
    end if;
    if new.credit_card_id is not null and invoice_card_id is distinct from new.credit_card_id then
      raise exception 'invoice does not belong to credit_card_id';
    end if;
  end if;

  if new.loan_id is not null then
    select owner_id into resource_owner
    from public.financial_loans
    where id = new.loan_id;
    if resource_owner is null or resource_owner is distinct from new.owner_id then
      raise exception 'loan access denied';
    end if;
  end if;

  if new.recurring_rule_id is not null then
    select owner_id into resource_owner
    from public.recurring_rules
    where id = new.recurring_rule_id;
    if resource_owner is null or resource_owner is distinct from new.owner_id then
      raise exception 'recurring rule access denied';
    end if;
  end if;

  return new;
end
$$;

alter table public.financial_transactions
  drop constraint if exists financial_transactions_target_check;
alter table public.financial_transactions
  add constraint financial_transactions_target_check check (
    account_id is not null
    or credit_card_id is not null
    or invoice_id is not null
    or loan_id is not null
    or recurring_rule_id is not null
    or (
      review_status = 'pending'
      and source in ('pluggy', 'ofx', 'csv', 'automation')
      and external_id is not null
    )
  );

update public.financial_transactions
set source_type = case when payment_source='payroll' then 'payroll' when credit_card_id is not null then 'card' when source='manual' then 'manual' when account_id is not null then 'bank' else 'automation' end,
    financial_origin = case when credit_card_id is not null then 'credit_card' when transaction_type='transfer' then 'transfer' when transaction_type in ('adjustment','refund','reversal') then 'adjustment' else 'bank_account' end,
    transaction_role = case when cash_flow_kind='invoice_payment' then 'invoice_payment' when transaction_type='transfer' then 'transfer' when transaction_type in ('refund','reversal') then 'refund' when transaction_type='adjustment' then 'adjustment' when credit_card_id is not null then 'consumption' else 'cash_flow' end,
    review_status = case
      when cash_flow_kind='invoice_payment'
       and (account_id is null or (credit_card_id is null and invoice_id is null))
       and source in ('pluggy','ofx','csv','automation')
       and external_id is not null
      then 'pending'
      else review_status
    end
where source_type is null or financial_origin is null or transaction_role is null;

alter table public.financial_transactions alter column source_type set default 'manual';
alter table public.financial_transactions alter column financial_origin set default 'bank_account';
alter table public.financial_transactions alter column transaction_role set default 'cash_flow';
alter table public.financial_transactions alter column source_type set not null;
alter table public.financial_transactions alter column financial_origin set not null;
alter table public.financial_transactions alter column transaction_role set not null;
alter table public.financial_transactions add constraint financial_transactions_source_type_check check(source_type in ('bank','card','manual','automation','payroll'));
alter table public.financial_transactions add constraint financial_transactions_origin_check check(financial_origin in ('bank_account','credit_card','invoice','transfer','adjustment'));
alter table public.financial_transactions add constraint financial_transactions_role_check check(transaction_role in ('consumption','cash_flow','invoice_payment','transfer','refund','adjustment'));
alter table public.card_purchases add constraint card_purchases_source_type_check check(source_type in ('bank','card','manual','automation','payroll'));
alter table public.card_purchases add constraint card_purchases_origin_check check(financial_origin in ('bank_account','credit_card','invoice','transfer','adjustment'));
alter table public.card_purchases add constraint card_purchases_role_check check(transaction_role in ('consumption','cash_flow','invoice_payment','transfer','refund','adjustment'));
alter table public.card_purchases add constraint card_purchases_review_check check(review_status in ('pending','reviewed','ignored'));

-- A regular unique index still permits multiple NULL external_id values in
-- PostgreSQL and can be inferred by both SQL ON CONFLICT and PostgREST upserts.
-- A partial index (`where external_id is not null`) cannot be inferred unless
-- every caller repeats its predicate, which caused SQLSTATE 42P10 here.
drop index if exists public.card_purchases_import_unique;
create unique index card_purchases_import_unique
  on public.card_purchases(owner_id,source,external_id);

insert into public.card_purchases(owner_id,workspace_id,card_id,category_id,description,total_amount,purchase_date,installment_number,installment_count,installment_amount,visibility,source,external_id,bank_connection_id,source_type,financial_origin,transaction_role,status,review_status,provider_category,merchant,currency,original_amount,provider_metadata,last_sync_at)
select t.owner_id,t.workspace_id,t.credit_card_id,t.category_id,t.description,t.amount,t.competence_date,case when t.provider_metadata->>'installmentNumber' ~ '^[0-9]+$' then greatest((t.provider_metadata->>'installmentNumber')::integer,1) else 1 end,case when t.provider_metadata->>'totalInstallments' ~ '^[0-9]+$' then greatest((t.provider_metadata->>'totalInstallments')::integer,1) else 1 end,t.amount,t.visibility,t.source,t.external_id,t.bank_connection_id,'card','credit_card',case when t.cash_flow_kind='invoice_payment' then 'invoice_payment' when t.transaction_type in ('refund','reversal') then 'refund' when t.transaction_type='adjustment' then 'adjustment' else 'consumption' end,t.status,t.review_status,t.provider_category,t.merchant,coalesce(t.original_currency,'BRL'),t.original_amount,t.provider_metadata,t.created_at
from public.financial_transactions t
where t.credit_card_id is not null and t.external_id is not null
on conflict(owner_id,source,external_id) do update set description=excluded.description,total_amount=excluded.total_amount,installment_amount=excluded.installment_amount,status=excluded.status,review_status=excluded.review_status,transaction_role=excluded.transaction_role,last_sync_at=excluded.last_sync_at;

update public.financial_transactions t set migrated_card_purchase_id=p.id
from public.card_purchases p
where t.credit_card_id is not null and t.external_id is not null and p.owner_id=t.owner_id and p.source=t.source and p.external_id=t.external_id and t.migrated_card_purchase_id is distinct from p.id;

create index if not exists financial_transactions_classification on public.financial_transactions(owner_id,source_type,transaction_role,competence_date desc);
create index if not exists card_purchases_classification on public.card_purchases(owner_id,transaction_role,purchase_date desc);
