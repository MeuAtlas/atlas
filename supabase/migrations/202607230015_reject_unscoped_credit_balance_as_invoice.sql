-- Account.balance may be shared/aggregated by a connector. It is diagnostic,
-- not an official invoice total unless a Bill scoped to this card exists.
alter table public.credit_cards drop constraint if exists credit_cards_provider_bill_total_scope_check;
alter table public.credit_cards add constraint credit_cards_provider_bill_total_scope_check
  check (provider_invoice_total is null or provider_bill_id is not null);

-- A provider Bill cannot belong to two different local credit accounts.
with duplicated_bills as (
  select owner_id,provider_bill_id
  from public.credit_cards
  where provider_bill_id is not null
  group by owner_id,provider_bill_id
  having count(distinct id)>1
), affected_cards as (
  select card.id
  from public.credit_cards card
  join duplicated_bills duplicate
    on duplicate.owner_id=card.owner_id
   and duplicate.provider_bill_id=card.provider_bill_id
)
update public.card_invoices invoice
set total_amount=coalesce(invoice.calculated_invoice_total,0),
    invoice_total=coalesce(invoice.calculated_invoice_total,0),
    outstanding_amount=greatest(0,coalesce(invoice.calculated_invoice_total,0)-invoice.paid_amount),
    total_source='calculated_transactions',
    source='atlas',
    provider_invoice_total=null,
    reconciliation_difference=null,
    reconciliation_status='provider_unavailable',
    updated_at=now()
where invoice.card_id in (select id from affected_cards);

with duplicated_bills as (
  select owner_id,provider_bill_id
  from public.credit_cards
  where provider_bill_id is not null
  group by owner_id,provider_bill_id
  having count(distinct id)>1
)
update public.credit_cards card
set provider_invoice_total=null,
    provider_bill_id=null,
    provider_bill_closing_date=null,
    provider_bill_due_date=null,
    provider_cycle_start_date=null,
    dates_source=case when card.dates_source='provider_bill' then 'pluggy' else card.dates_source end
from duplicated_bills duplicate
where duplicate.owner_id=card.owner_id
  and duplicate.provider_bill_id=card.provider_bill_id;

-- Repair invoices materialized by the unsafe Account.balance fallback.
update public.card_invoices
set total_amount=coalesce(calculated_invoice_total,0),
    invoice_total=coalesce(calculated_invoice_total,0),
    outstanding_amount=greatest(0,coalesce(calculated_invoice_total,0)-paid_amount),
    total_source='calculated_transactions',
    source='atlas',
    reconciliation_difference=null,
    reconciliation_status='provider_unavailable',
    updated_at=now()
where total_source='credit_account_balance';

-- used_limit was previously populated from Account.balance. Reset the unsafe
-- value; the next sync derives it only from creditLimit - availableCreditLimit.
update public.credit_cards
set used_limit=0
where source='pluggy';
