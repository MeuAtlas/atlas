-- Restore the pre-incident snapshot that predates value-history auditing.
-- Every predicate is intentional: this is a one-row, one-transition repair.

update public.card_invoices
set
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
  and current_display_total=7082.45
  and last_reliable_invoice_total=7082.45
  and coalesce(calculated_invoice_total,0)<=7082.45;
