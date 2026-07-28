-- Persist a complete review atomically before exposing needs_review.
alter table public.invoice_documents
  add column if not exists processed_at timestamptz,
  add column if not exists cycle_start_date date,
  add column if not exists cycle_end_date date,
  add column if not exists closing_date date,
  add column if not exists due_date date,
  add column if not exists official_total numeric(15,2),
  add column if not exists minimum_payment_amount numeric(15,2),
  add column if not exists previous_balance numeric(15,2),
  add column if not exists payments_total numeric(15,2),
  add column if not exists credits_total numeric(15,2),
  add column if not exists domestic_debits_total numeric(15,2),
  add column if not exists foreign_debits_total numeric(15,2);

create or replace function public.persist_invoice_import_review(
  p_document_id uuid,
  p_version integer,
  p_review jsonb
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare
  affected integer;
  parsed jsonb := p_review->'parsed';
  reconciliation jsonb := p_review->'reconciliation';
begin
  if jsonb_typeof(p_review) <> 'object'
    or jsonb_typeof(parsed) <> 'object'
    or jsonb_typeof(parsed->'entries') <> 'array'
    or nullif(p_review->>'documentId','')::uuid <> p_document_id then
    raise exception 'invalid_invoice_review_payload';
  end if;

  update public.invoice_documents
  set
    processing_version=p_version,
    bank_code=nullif(parsed->>'bankCode',''),
    bank_name=nullif(parsed->>'bankName',''),
    parser_name=coalesce(nullif(parsed->>'parserName',''),'unknown'),
    parser_version=coalesce(nullif(parsed->>'parserVersion',''),'0'),
    parsed_payload=p_review,
    parser_warnings=coalesce(parsed->'warnings','[]'::jsonb),
    confidence=coalesce((parsed->>'confidence')::numeric,0),
    cycle_start_date=nullif(parsed->>'cycleStartDate','')::date,
    cycle_end_date=nullif(parsed->>'cycleEndDate','')::date,
    closing_date=nullif(parsed->>'closingDate','')::date,
    due_date=nullif(parsed->>'dueDate','')::date,
    official_total=round(nullif(parsed->>'officialTotalCents','')::numeric/100,2),
    minimum_payment_amount=round(nullif(parsed->>'minimumPaymentCents','')::numeric/100,2),
    previous_balance=round(nullif(parsed->>'previousBalanceCents','')::numeric/100,2),
    payments_total=round(coalesce((reconciliation->>'paymentsCents')::numeric,0)/100,2),
    credits_total=round(coalesce((reconciliation->>'creditsCents')::numeric,0)/100,2),
    domestic_debits_total=round(nullif(parsed->'santanderSummary'->>'domesticDebitsCents','')::numeric/100,2),
    foreign_debits_total=round(nullif(parsed->'santanderSummary'->>'foreignDebitsCents','')::numeric/100,2),
    provider_future_installment_balance=round(nullif(parsed->>'providerFutureInstallmentBalanceCents','')::numeric/100,2),
    next_open_invoice_amount=round(nullif(parsed->>'nextOpenInvoiceAmountCents','')::numeric/100,2),
    next_cycle_start_date=nullif(parsed->>'nextCycleStartDate','')::date,
    next_cycle_end_date=nullif(parsed->>'nextCycleEndDate','')::date,
    processing_status='needs_review',
    review_status='in_review',
    processed_at=now(),
    processing_lock_until=null,
    processing_error_code=case
      when parsed->>'parserName'='manual_assisted' then
        case when extraction_method='image_only' then 'IMAGE_ONLY_PDF' else 'UNSUPPORTED_LAYOUT' end
      else null
    end,
    processing_error_message=case
      when parsed->>'parserName'='manual_assisted' then parsed->'warnings'->>0
      else null
    end,
    last_processing_error_code=null,
    last_processing_error_message=null
  where id=p_document_id
    and user_id=auth.uid()
    and deleted_at is null
    and confirmed_at is null;
  get diagnostics affected=row_count;
  if affected <> 1 then return false; end if;

  insert into public.invoice_processing_versions(
    document_id,owner_id,version,parser_name,parser_version,parsed_payload,confidence
  )
  select
    doc.id,doc.user_id,p_version,doc.parser_name,doc.parser_version,p_review,doc.confidence
  from public.invoice_documents doc
  where doc.id=p_document_id and doc.user_id=auth.uid()
  on conflict(document_id,version) do update set
    parser_name=excluded.parser_name,
    parser_version=excluded.parser_version,
    parsed_payload=excluded.parsed_payload,
    confidence=excluded.confidence;

  return true;
end
$$;

grant execute on function public.persist_invoice_import_review(uuid,integer,jsonb)
  to authenticated;

-- A needs_review row without a valid payload is recoverable, never reviewable.
update public.invoice_documents
set
  processing_status='failed',
  review_status='pending',
  processing_lock_until=null,
  processing_error_code='INCOMPLETE_REVIEW_PAYLOAD',
  processing_error_message='A revisão anterior não foi persistida por completo.',
  last_processing_error_code='INCOMPLETE_REVIEW_PAYLOAD',
  last_processing_error_message='A revisão anterior não foi persistida por completo.'
where processing_status in ('needs_review','parsed')
  and confirmed_at is null
  and (
    parsed_payload is null
    or jsonb_typeof(parsed_payload) <> 'object'
    or jsonb_typeof(parsed_payload->'parsed') <> 'object'
    or jsonb_typeof(parsed_payload->'parsed'->'entries') <> 'array'
  );
