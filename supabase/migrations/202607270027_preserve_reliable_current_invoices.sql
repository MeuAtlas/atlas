-- Preserve the last reliable invoice snapshot when a provider sync is partial.
-- The repair below is evidence-based: totals are rebuilt only from persisted
-- purchases that belong to each invoice cycle.

alter table public.card_invoices
  add column if not exists last_reliable_invoice_total numeric(15,2),
  add column if not exists current_display_total numeric(15,2),
  add column if not exists last_reliable_purchase_count integer,
  add column if not exists data_completeness text not null default 'unknown',
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_complete_sync_at timestamptz,
  add column if not exists stale_since timestamptz,
  add column if not exists provider_status text not null default 'waiting',
  add column if not exists preservation_reason text;

alter table public.card_invoices
  drop constraint if exists card_invoices_data_completeness_check;
alter table public.card_invoices
  add constraint card_invoices_data_completeness_check
  check (data_completeness in ('complete','partial','unknown'));

alter table public.card_invoices
  drop constraint if exists card_invoices_provider_status_check;
alter table public.card_invoices
  add constraint card_invoices_provider_status_check
  check (provider_status in ('available','degraded','unavailable','waiting'));

create or replace function public.preserve_reliable_card_invoice()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  preserve_drop boolean := false;
begin
  if tg_op = 'UPDATE' and new.data_completeness = 'partial' then
    preserve_drop :=
      (coalesce(old.purchase_count, 0) > 0 and coalesce(new.purchase_count, 0) = 0)
      or (
        coalesce(old.calculated_invoice_total, 0) > 0
        and coalesce(new.calculated_invoice_total, 0) = 0
      );

    if preserve_drop then
      new.purchases_total := old.purchases_total;
      new.credits_total := old.credits_total;
      new.adjustments_total := old.adjustments_total;
      new.instruments_total := old.instruments_total;
      new.unassigned_total := old.unassigned_total;
      new.unassigned_transactions_total := old.unassigned_transactions_total;
      new.general_adjustments_total := old.general_adjustments_total;
      new.calculated_invoice_total := old.calculated_invoice_total;
      new.purchase_count := old.purchase_count;
      new.invoice_total := old.invoice_total;
      new.total_amount := old.total_amount;
      new.outstanding_amount := old.outstanding_amount;
      new.invoice_breakdown := old.invoice_breakdown;
      new.reconciliation_difference := old.reconciliation_difference;
      new.reconciliation_status := old.reconciliation_status;
      new.preservation_reason := coalesce(
        new.preservation_reason,
        'partial_sync_abrupt_drop'
      );
    end if;

    if old.provider_invoice_total is not null
       and old.provider_invoice_total <> 0
       and coalesce(new.provider_invoice_total, 0) = 0 then
      new.provider_invoice_total := old.provider_invoice_total;
    end if;

    new.last_reliable_invoice_total := coalesce(
      old.last_reliable_invoice_total,
      old.provider_invoice_total,
      old.manual_invoice_total,
      old.confirmed_invoice_total,
      old.calculated_invoice_total
    );
    new.last_reliable_purchase_count := coalesce(
      old.last_reliable_purchase_count,
      old.purchase_count
    );
    new.last_complete_sync_at := old.last_complete_sync_at;
    new.stale_since := coalesce(old.stale_since, new.last_sync_at, now());
    new.provider_status := 'degraded';
  elsif new.data_completeness = 'complete' then
    new.last_reliable_invoice_total := coalesce(
      new.provider_invoice_total,
      new.manual_invoice_total,
      new.confirmed_invoice_total,
      new.calculated_invoice_total
    );
    new.last_reliable_purchase_count := new.purchase_count;
    new.last_complete_sync_at := coalesce(new.last_complete_sync_at, now());
    new.stale_since := null;
    new.provider_status := 'available';
    new.preservation_reason := null;
  end if;

  new.current_display_total := coalesce(
    new.provider_invoice_total,
    new.manual_invoice_total,
    new.confirmed_invoice_total,
    new.calculated_invoice_total,
    new.last_reliable_invoice_total
  );
  return new;
end
$$;

drop trigger if exists card_invoices_preserve_reliable on public.card_invoices;
create trigger card_invoices_preserve_reliable
before insert or update on public.card_invoices
for each row execute function public.preserve_reliable_card_invoice();

with evidence as (
  select
    invoice.id,
    coalesce(sum(
      case
        when purchase.transaction_role = 'consumption'
          and coalesce(purchase.review_status, 'reviewed') <> 'pending'
          then abs(purchase.installment_amount)
        when purchase.transaction_role = 'refund'
          then -abs(purchase.installment_amount)
        when purchase.transaction_role = 'adjustment'
          and coalesce(purchase.original_amount, -purchase.installment_amount) < 0
          then abs(purchase.installment_amount)
        when purchase.transaction_role = 'adjustment'
          then -abs(purchase.installment_amount)
        else 0
      end
    ), 0) as calculated_total,
    count(*) filter (
      where purchase.transaction_role = 'consumption'
        and coalesce(purchase.review_status, 'reviewed') <> 'pending'
    ) as purchase_count
  from public.card_invoices invoice
  join public.card_purchases purchase
    on purchase.card_id = invoice.card_id
   and purchase.status <> 'cancelled'
   and coalesce(
     purchase.bill_forecast_date,
     purchase.purchase_date,
     purchase.competence_date
   ) between invoice.cycle_start_date and invoice.cycle_end_date
  group by invoice.id
),
repairable as (
  select evidence.*
  from evidence
  join public.card_invoices invoice on invoice.id = evidence.id
  where evidence.purchase_count > 0
    and (
      coalesce(invoice.purchase_count, 0) = 0
      or coalesce(invoice.calculated_invoice_total, 0) = 0
    )
)
update public.card_invoices invoice
set
  calculated_invoice_total = greatest(0, repairable.calculated_total),
  purchase_count = repairable.purchase_count,
  invoice_total = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    greatest(0, repairable.calculated_total)
  ),
  total_amount = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    greatest(0, repairable.calculated_total)
  ),
  outstanding_amount = greatest(
    0,
    coalesce(
      invoice.provider_invoice_total,
      invoice.manual_invoice_total,
      invoice.confirmed_invoice_total,
      greatest(0, repairable.calculated_total)
    ) - invoice.paid_amount
  ),
  last_reliable_invoice_total = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    greatest(0, repairable.calculated_total)
  ),
  current_display_total = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    greatest(0, repairable.calculated_total)
  ),
  last_reliable_purchase_count = repairable.purchase_count,
  data_completeness = case
    when connection.data_completeness = 'partial' then 'partial'
    else invoice.data_completeness
  end,
  provider_status = case
    when connection.data_completeness = 'partial' then 'degraded'
    else invoice.provider_status
  end,
  stale_since = case
    when connection.data_completeness = 'partial'
      then coalesce(invoice.stale_since, connection.stale_since, now())
    else invoice.stale_since
  end,
  preservation_reason = 'restored_from_persisted_purchases',
  updated_at = now()
from repairable, public.credit_cards card
left join public.bank_connections connection on connection.id = card.bank_connection_id
where invoice.id = repairable.id
  and card.id = invoice.card_id;

update public.card_invoices
set
  last_reliable_invoice_total = coalesce(
    last_reliable_invoice_total,
    provider_invoice_total,
    manual_invoice_total,
    confirmed_invoice_total,
    calculated_invoice_total
  ),
  current_display_total = coalesce(
    provider_invoice_total,
    manual_invoice_total,
    confirmed_invoice_total,
    calculated_invoice_total,
    last_reliable_invoice_total
  ),
  last_reliable_purchase_count = coalesce(
    last_reliable_purchase_count,
    purchase_count
  ),
  last_sync_at = coalesce(last_sync_at, provider_updated_at, updated_at);
