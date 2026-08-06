begin;

insert into public.expense_establishment_transactions (
  workspace_id, establishment_id, invoice_entry_id, association_source, is_active, created_by
)
select
  linked.workspace_id,
  linked.establishment_id,
  candidate.id,
  'historical_backfill',
  true,
  linked.created_by
from public.expense_establishment_transactions linked
join public.invoice_entries source on source.id = linked.invoice_entry_id
join public.invoice_entries candidate
  on candidate.workspace_id = source.workspace_id
 and candidate.merchant_normalized = source.merchant_normalized
 and candidate.entry_type in ('purchase', 'installment_purchase')
where linked.is_active
  and source.merchant_normalized is not null
  and not exists (
    select 1 from public.expense_establishment_transactions existing
    where existing.invoice_entry_id = candidate.id
  );

commit;
