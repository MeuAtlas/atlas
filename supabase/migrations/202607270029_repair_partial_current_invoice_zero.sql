-- A partial sync cannot promote synthetic zeroes to reliable invoice facts.
-- Recover current-cycle snapshots only from persisted, scoped purchase evidence.

alter table public.card_invoices
  add column if not exists purchase_count_source text;

alter table public.card_invoices
  drop constraint if exists card_invoices_purchase_count_source_check;
alter table public.card_invoices
  add constraint card_invoices_purchase_count_source_check check (
    purchase_count_source is null or purchase_count_source in (
      'provider_bill','complete_transactions','persisted_purchases_backfill',
      'last_reliable','unavailable'
    )
  );

create or replace function public.preserve_reliable_card_invoice()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  old_reliable_total numeric(15,2);
  old_reliable_count integer;
begin
  if tg_op='UPDATE' then
    old_reliable_total:=coalesce(
      old.manual_invoice_total,
      old.confirmed_invoice_total,
      case when old.last_complete_sync_at is not null
        then old.provider_invoice_total end,
      case when old.last_complete_sync_at is not null
        then old.calculated_invoice_total end,
      nullif(old.last_reliable_invoice_total,0),
      nullif(old.current_display_total,0),
      nullif(old.total_amount,0),
      case when old.last_complete_sync_at is not null then 0 end
    );
    old_reliable_count:=coalesce(
      nullif(old.last_reliable_purchase_count,0),
      nullif(old.purchase_count,0),
      case when old.last_complete_sync_at is not null then 0 end
    );
  end if;

  if new.preservation_reason in (
    'restored_from_persisted_purchases_v2',
    'partial_sync_without_reliable_snapshot'
  ) then
    return new;
  end if;

  if new.data_completeness='partial' then
    if tg_op='UPDATE' then
      new.purchases_total:=old.purchases_total;
      new.credits_total:=old.credits_total;
      new.adjustments_total:=old.adjustments_total;
      new.instruments_total:=old.instruments_total;
      new.unassigned_total:=old.unassigned_total;
      new.unassigned_transactions_total:=old.unassigned_transactions_total;
      new.general_adjustments_total:=old.general_adjustments_total;
      new.invoice_total:=old.invoice_total;
      new.total_amount:=old.total_amount;
      new.outstanding_amount:=old.outstanding_amount;
      new.purchase_count:=old.purchase_count;
      new.provider_invoice_total:=old.provider_invoice_total;
      new.calculated_invoice_total:=old.calculated_invoice_total;
      new.reconciliation_difference:=old.reconciliation_difference;
      new.reconciliation_status:=old.reconciliation_status;
      new.invoice_breakdown:=old.invoice_breakdown;
      new.last_reliable_invoice_total:=old_reliable_total;
      new.current_display_total:=old_reliable_total;
      new.last_reliable_purchase_count:=old_reliable_count;
      new.purchase_count_source:=case
        when old_reliable_count is null then 'unavailable'
        else 'last_reliable'
      end;
      new.last_complete_sync_at:=old.last_complete_sync_at;
      new.preservation_reason:=coalesce(
        new.preservation_reason,'partial_sync_preserved_previous'
      );
    else
      new.last_reliable_invoice_total:=null;
      new.current_display_total:=null;
      new.last_reliable_purchase_count:=null;
      new.purchase_count_source:='unavailable';
      new.preservation_reason:=coalesce(
        new.preservation_reason,'partial_sync_without_reliable_snapshot'
      );
    end if;
    new.provider_status:='degraded';
    if tg_op='UPDATE' then
      new.stale_since:=coalesce(old.stale_since,new.last_sync_at,now());
    else
      new.stale_since:=coalesce(new.stale_since,new.last_sync_at,now());
    end if;
  elsif new.data_completeness='complete' then
    new.last_reliable_invoice_total:=coalesce(
      new.provider_invoice_total,new.manual_invoice_total,
      new.confirmed_invoice_total,new.calculated_invoice_total
    );
    new.current_display_total:=new.last_reliable_invoice_total;
    new.last_reliable_purchase_count:=new.purchase_count;
    new.purchase_count_source:=case
      when new.provider_bill_id is not null then 'provider_bill'
      else 'complete_transactions'
    end;
    new.last_complete_sync_at:=coalesce(new.last_complete_sync_at,now());
    new.stale_since:=null;
    new.provider_status:='available';
    new.preservation_reason:=null;
  else
    new.current_display_total:=coalesce(
      new.manual_invoice_total,new.confirmed_invoice_total,
      nullif(new.last_reliable_invoice_total,0),
      nullif(new.current_display_total,0)
    );
  end if;
  return new;
end
$$;

with persisted_evidence as (
  select
    invoice.id,
    round(sum(case
      when purchase.transaction_role='consumption'
        and coalesce(purchase.review_status,'reviewed')<>'pending'
        then abs(purchase.installment_amount)
      when purchase.transaction_role='refund'
        then -abs(purchase.installment_amount)
      when purchase.transaction_role='adjustment'
        and coalesce(purchase.original_amount,-purchase.installment_amount)>0
        then -abs(purchase.installment_amount)
      when purchase.transaction_role='adjustment'
        then abs(purchase.installment_amount)
      else 0
    end),2) calculated_total,
    count(*) filter (
      where purchase.transaction_role='consumption'
        and coalesce(purchase.review_status,'reviewed')<>'pending'
    ) purchase_count
  from public.card_invoices invoice
  join public.card_purchases purchase
    on purchase.card_id=invoice.card_id
   and purchase.status<>'cancelled'
   and coalesce(
     purchase.bill_forecast_date,
     purchase.purchase_date,
     purchase.competence_date
   ) between invoice.cycle_start_date and invoice.cycle_end_date
  group by invoice.id
), repairable as (
  select evidence.*
  from persisted_evidence evidence
  join public.card_invoices invoice on invoice.id=evidence.id
  where evidence.purchase_count>0
    and (
      invoice.data_completeness<>'complete'
      or coalesce(invoice.purchase_count,0)=0
      or coalesce(invoice.calculated_invoice_total,0)=0
      or invoice.last_reliable_invoice_total is null
    )
)
update public.card_invoices invoice set
  calculated_invoice_total=greatest(0,repair.calculated_total),
  purchases_total=greatest(0,repair.calculated_total),
  purchase_count=repair.purchase_count,
  last_reliable_invoice_total=coalesce(
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    nullif(invoice.provider_invoice_total,0),
    greatest(0,repair.calculated_total)
  ),
  current_display_total=coalesce(
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    nullif(invoice.provider_invoice_total,0),
    greatest(0,repair.calculated_total)
  ),
  last_reliable_purchase_count=repair.purchase_count,
  purchase_count_source='persisted_purchases_backfill',
  invoice_total=coalesce(
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    nullif(invoice.provider_invoice_total,0),
    greatest(0,repair.calculated_total)
  ),
  total_amount=coalesce(
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    nullif(invoice.provider_invoice_total,0),
    greatest(0,repair.calculated_total)
  ),
  outstanding_amount=greatest(0,coalesce(
    invoice.manual_invoice_total,
    invoice.confirmed_invoice_total,
    nullif(invoice.provider_invoice_total,0),
    greatest(0,repair.calculated_total)
  )-invoice.paid_amount),
  provider_status=case when invoice.data_completeness='complete'
    then invoice.provider_status else 'degraded' end,
  stale_since=case when invoice.data_completeness='complete'
    then invoice.stale_since else coalesce(invoice.stale_since,now()) end,
  preservation_reason='restored_from_persisted_purchases_v2',
  updated_at=now()
from repairable repair
where invoice.id=repair.id;

update public.card_invoices invoice set
  last_reliable_invoice_total=null,
  current_display_total=null,
  last_reliable_purchase_count=null,
  purchase_count_source='unavailable',
  preservation_reason='partial_sync_without_reliable_snapshot',
  updated_at=now()
where invoice.data_completeness='partial'
  and invoice.last_complete_sync_at is null
  and coalesce(invoice.provider_invoice_total,0)=0
  and invoice.manual_invoice_total is null
  and invoice.confirmed_invoice_total is null
  and coalesce(invoice.calculated_invoice_total,0)=0
  and coalesce(invoice.purchase_count,0)=0
  and not exists (
    select 1 from public.card_purchases purchase
    where purchase.card_id=invoice.card_id
      and purchase.status<>'cancelled'
      and purchase.transaction_role='consumption'
      and coalesce(purchase.review_status,'reviewed')<>'pending'
      and coalesce(
        purchase.bill_forecast_date,
        purchase.purchase_date,
        purchase.competence_date
      ) between invoice.cycle_start_date and invoice.cycle_end_date
  );
