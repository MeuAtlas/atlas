-- Card-cycle movement dry-run. Read-only and safe to execute repeatedly.
begin;
set transaction read only;

-- 1. Persisted cycles and the totals that must remain semantically separate.
select
  left(invoice.owner_id::text, 8) || '…' as owner_masked,
  left(invoice.id::text, 8) || '…' as cycle_id_masked,
  left(invoice.card_id::text, 8) || '…' as card_id_masked,
  invoice.cycle_start_date,
  invoice.cycle_end_date,
  invoice.due_date,
  invoice.status,
  invoice.source,
  invoice.official_total,
  invoice.identified_entries_total,
  invoice.previous_balance,
  invoice.payments_total,
  invoice.credits_total,
  invoice.finance_charges_total,
  invoice.reconciliation_difference,
  invoice.data_completeness
from public.card_invoices invoice
where invoice.cycle_start_date is not null
  and invoice.cycle_end_date is not null
order by invoice.cycle_end_date desc, invoice.card_id;

-- 2. Open-cycle Pluggy/manual movements selected by competence date. A foreign
-- or null invoice_id does not exclude a real movement from the open window.
select
  left(invoice.id::text, 8) || '…' as cycle_id_masked,
  left(purchase.id::text, 8) || '…' as purchase_id_masked,
  left(coalesce(purchase.external_id, '')::text, 6) || '…' as external_id_masked,
  left(purchase.card_id::text, 8) || '…' as card_id_masked,
  left(coalesce(purchase.invoice_id::text, ''), 8) || '…' as linked_invoice_masked,
  purchase.source,
  purchase.competence_date,
  purchase.installment_amount,
  purchase.transaction_role,
  purchase.status
from public.card_invoices invoice
join public.card_purchases purchase
  on purchase.owner_id = invoice.owner_id
 and purchase.card_id = invoice.card_id
 and purchase.competence_date between invoice.cycle_start_date and invoice.cycle_end_date
where invoice.status in ('open', 'partial')
  and invoice.source <> 'pdf'
  and purchase.status not in ('cancelled', 'forecast')
  and purchase.transaction_role <> 'invoice_payment'
order by invoice.cycle_end_date desc, purchase.competence_date, purchase.id;

-- 3. Closed PDF composition. Only these entry types affect consumption.
select
  left(entry.bill_id::text, 8) || '…' as cycle_id_masked,
  entry.entry_type,
  count(*) as entry_count,
  round(sum(abs(entry.amount)), 2) as absolute_total,
  round(sum(
    case
      when entry.entry_type in ('credit', 'refund') then -abs(entry.amount)
      when entry.entry_type = 'adjustment' and entry.amount < 0 then -abs(entry.amount)
      else abs(entry.amount)
    end
  ), 2) as invoice_effect
from public.invoice_entries entry
where not entry.is_ignored
  and entry.entry_type in (
    'purchase', 'installment_purchase', 'credit', 'refund',
    'fee', 'interest', 'tax', 'adjustment'
  )
group by entry.bill_id, entry.entry_type
order by entry.bill_id, entry.entry_type;

-- 4. Strong PDF/Pluggy reconciliation pairs and presentation duplicates.
select
  left(entry.bill_id::text, 8) || '…' as cycle_id_masked,
  left(entry.id::text, 8) || '…' as invoice_entry_id_masked,
  left(purchase.id::text, 8) || '…' as purchase_id_masked,
  left(entry.provider_transaction_id, 6) || '…' as provider_transaction_masked,
  entry.transaction_date as pdf_date,
  purchase.competence_date as pluggy_date,
  abs(entry.amount) as pdf_amount,
  abs(purchase.installment_amount) as pluggy_amount
from public.invoice_entries entry
join public.card_purchases purchase
  on purchase.owner_id = entry.owner_id
 and purchase.external_id = entry.provider_transaction_id
where entry.provider_transaction_id is not null
order by entry.bill_id, entry.transaction_date, entry.id;

-- 5. Current projected/confirmed installments that have no posted entry yet.
select
  left(occurrence.id::text, 8) || '…' as occurrence_id_masked,
  left(occurrence.card_id::text, 8) || '…' as card_id_masked,
  occurrence.competence_month,
  occurrence.installment_number,
  occurrence.total_installments,
  occurrence.amount,
  occurrence.status,
  occurrence.source,
  occurrence.invoice_entry_id is not null as has_posted_entry
from public.card_installment_occurrences occurrence
where occurrence.status in ('projected', 'confirmed')
order by occurrence.competence_month, occurrence.card_id, occurrence.installment_number;

rollback;
