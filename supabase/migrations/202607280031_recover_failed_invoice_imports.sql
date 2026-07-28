-- Recoverable PDF processing state, atomic locks and an active-document hash key.
alter table public.invoice_documents
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_lock_until timestamptz,
  add column if not exists last_processing_attempt_at timestamptz,
  add column if not exists last_processing_error_code text,
  add column if not exists last_processing_error_message text;

alter table public.invoice_documents
  drop constraint if exists invoice_documents_workspace_id_card_id_file_hash_key;
drop index if exists public.invoice_documents_active_file_hash;
create unique index invoice_documents_active_file_hash
  on public.invoice_documents(workspace_id,card_id,file_hash)
  where deleted_at is null;

-- Rows left in a processing state for more than 15 minutes are recoverable.
update public.invoice_documents
set
  processing_status='failed',
  processing_lock_until=null,
  processing_error_code='PROCESSING_TIMEOUT',
  processing_error_message='O processamento anterior não foi concluído.',
  last_processing_error_code='PROCESSING_TIMEOUT',
  last_processing_error_message='O processamento anterior não foi concluído.'
where processing_status in ('extracting','parsing')
  and confirmed_at is null
  and coalesce(processing_started_at,updated_at) < now()-interval '15 minutes';

create or replace function public.acquire_invoice_document_processing(
  p_document_id uuid,
  p_lock_seconds integer default 300
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare
  affected integer;
begin
  update public.invoice_documents
  set
    processing_status='extracting',
    processing_started_at=now(),
    processing_lock_until=now()+make_interval(secs=>least(greatest(p_lock_seconds,60),900)),
    processing_attempts=processing_attempts+1,
    last_processing_attempt_at=now(),
    processing_error_code=null,
    processing_error_message=null,
    last_processing_error_code=null,
    last_processing_error_message=null
  where id=p_document_id
    and user_id=auth.uid()
    and deleted_at is null
    and confirmed_at is null
    and review_status<>'approved'
    and processing_status<>'confirmed'
    and (processing_lock_until is null or processing_lock_until<=now());
  get diagnostics affected=row_count;
  return affected=1;
end
$$;

create or replace function public.fail_invoice_document_processing(
  p_document_id uuid,
  p_error_code text,
  p_error_message text
)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  update public.invoice_documents
  set
    processing_status='failed',
    processing_lock_until=null,
    processing_error_code=left(p_error_code,80),
    processing_error_message=left(p_error_message,500),
    last_processing_error_code=left(p_error_code,80),
    last_processing_error_message=left(p_error_message,500)
  where id=p_document_id
    and user_id=auth.uid()
    and confirmed_at is null
    and review_status<>'approved';
end
$$;

create or replace function public.delete_failed_invoice_import(p_document_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  doc public.invoice_documents%rowtype;
begin
  select * into doc
  from public.invoice_documents
  where id=p_document_id and user_id=auth.uid() and deleted_at is null
  for update;
  if doc.id is null then raise exception 'invoice_document_not_found'; end if;
  if doc.confirmed_at is not null or doc.review_status='approved'
    or doc.processing_status='confirmed' or doc.bill_id is not null then
    raise exception 'confirmed_invoice_document_cannot_be_deleted';
  end if;
  if exists(
    select 1 from public.invoice_entries entry
    join public.card_installment_occurrences occurrence
      on occurrence.invoice_entry_id=entry.id
    where entry.document_id=doc.id
      and occurrence.status in ('confirmed','paid','posted')
  ) then raise exception 'confirmed_installments_depend_on_document'; end if;

  delete from public.invoice_entries where document_id=doc.id;
  update public.invoice_documents set
    deleted_at=now(),review_status='rejected',processing_lock_until=null,
    parsed_payload=null,extracted_text=null
  where id=doc.id;
  return jsonb_build_object(
    'documentId',doc.id,
    'storageBucket',doc.storage_bucket,
    'storagePath',doc.storage_path
  );
end
$$;

grant execute on function public.acquire_invoice_document_processing(uuid,integer) to authenticated;
grant execute on function public.fail_invoice_document_processing(uuid,text,text) to authenticated;
grant execute on function public.delete_failed_invoice_import(uuid) to authenticated;
