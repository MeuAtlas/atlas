-- The incident row was calculated, but stale confirmation aliases kept the
-- lower partial value above the reliable snapshot in the resolver priority.

update public.card_invoices
set
  manual_invoice_total=null,
  confirmed_invoice_total=null,
  current_display_total=7669.72,
  last_reliable_invoice_total=7669.72,
  data_completeness='partial',
  preservation_reason='partial_bill_lower_than_reliable_snapshot',
  value_change_reason='partial_sync_preserved',
  value_change_source='recovery',
  updated_at=now()
where id='0219faee-6359-4071-ac45-8a0fa3423764'::uuid
  and status='open'
  and data_completeness='partial'
  and source='calculated'
  and total_source='calculated_transactions'
  and provider_invoice_total is null
  and provider_bill_id is null
  and current_display_total=7082.45
  and last_reliable_invoice_total=7082.45
  and manual_invoice_total=7082.45
  and confirmed_invoice_total=7082.45
  and coalesce(calculated_invoice_total,0)<=7082.45;
