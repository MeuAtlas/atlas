-- Positional PDF parser metadata. Raw coordinates stay transient in application memory.
alter table public.invoice_documents
  add column if not exists extraction_layout_version integer,
  add column if not exists parser_warnings jsonb not null default '[]'::jsonb,
  add column if not exists provider_future_installment_balance numeric(15,2),
  add column if not exists next_open_invoice_amount numeric(15,2),
  add column if not exists next_cycle_start_date date,
  add column if not exists next_cycle_end_date date;

update public.invoice_documents
set extraction_method='text_layer'
where extraction_method='text';

alter table public.invoice_documents
  drop constraint if exists invoice_documents_extraction_method_check;
alter table public.invoice_documents
  add constraint invoice_documents_extraction_method_check
  check(extraction_method is null or extraction_method in ('text_layer','image_only'));

comment on column public.invoice_documents.extraction_layout_version is
  'Version of the transient positional extraction algorithm. Raw coordinates are not persisted.';
comment on column public.invoice_documents.parser_warnings is
  'Sanitized parser warnings only; never raw PDF text or personal data.';
