-- Persist safe extraction diagnostics without storing positional financial data.
alter table public.invoice_documents
  add column if not exists extractor_version text,
  add column if not exists page_count integer
    check(page_count is null or page_count > 0),
  add column if not exists extracted_character_count integer
    check(extracted_character_count is null or extracted_character_count >= 0),
  add column if not exists extraction_warnings jsonb not null default '[]'::jsonb
    check(jsonb_typeof(extraction_warnings)='array');

comment on column public.invoice_documents.extractor_version is
  'Server-side PDF text extractor version; contains no document contents.';
comment on column public.invoice_documents.extracted_character_count is
  'Count only; extracted text remains protected by invoice_documents RLS.';
