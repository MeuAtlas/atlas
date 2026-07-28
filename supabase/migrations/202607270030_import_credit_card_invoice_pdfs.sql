-- Private PDF invoice ingestion, review and installment projections.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('financial-documents','financial-documents',false,20971520,array['application/pdf'])
on conflict(id) do update set
  public=false,
  file_size_limit=20971520,
  allowed_mime_types=array['application/pdf'];

create table if not exists public.invoice_documents(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  bill_id uuid,
  storage_bucket text not null default 'financial-documents',
  storage_path text not null,
  original_filename text not null,
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
  file_size_bytes bigint not null check(file_size_bytes > 0 and file_size_bytes <= 20971520),
  mime_type text not null check(mime_type='application/pdf'),
  bank_code text,
  bank_name text,
  parser_name text,
  parser_version text,
  processing_version integer not null default 1,
  extraction_method text check(extraction_method in ('text','image_only')),
  extracted_text text,
  parsed_payload jsonb,
  processing_status text not null default 'uploaded'
    check(processing_status in ('uploaded','extracting','extracted','parsing','parsed','needs_review','confirmed','failed')),
  confidence numeric(5,4) check(confidence between 0 and 1),
  processing_error_code text,
  processing_error_message text,
  review_status text not null default 'pending'
    check(review_status in ('pending','in_review','approved','rejected')),
  imported_at timestamptz,
  confirmed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,card_id,file_hash),
  unique(storage_bucket,storage_path)
);

alter table public.card_invoices
  add column if not exists document_id uuid references public.invoice_documents(id) on delete set null,
  add column if not exists source text not null default 'calculated',
  add column if not exists official_total numeric(15,2),
  add column if not exists identified_entries_total numeric(15,2),
  add column if not exists credits_total numeric(15,2),
  add column if not exists payments_total numeric(15,2),
  add column if not exists finance_charges_total numeric(15,2),
  add column if not exists previous_balance numeric(15,2),
  add column if not exists confidence numeric(5,4),
  add column if not exists confirmed_by_user boolean not null default false;

-- `source` already existed since migration 011 and contains the legacy values
-- atlas/pluggy/manual_bank_confirmation. Normalize them before enforcing the
-- new document-oriented domain; otherwise ADD CONSTRAINT fails on live data.
update public.card_invoices
set source=case
  when source in ('pdf','pluggy_bill','manual','calculated','payment_confirmation') then source
  when source in ('pluggy','provider_bill') or provider_bill_id is not null then 'pluggy_bill'
  when source in ('manual_bank_confirmation','manual_pdf_confirmation') then 'manual'
  when source in ('confirmed_by_full_payment','payment') then 'payment_confirmation'
  else 'calculated'
end
where source not in ('pdf','pluggy_bill','manual','calculated','payment_confirmation')
   or source is null;

alter table public.card_invoices alter column source set default 'calculated';
alter table public.card_invoices drop constraint if exists card_invoices_source_check;
alter table public.card_invoices add constraint card_invoices_source_check
  check(source in ('pdf','pluggy_bill','manual','calculated','payment_confirmation'));
alter table public.card_invoices drop constraint if exists card_invoices_total_source_check;
alter table public.card_invoices add constraint card_invoices_total_source_check
  check(total_source in ('provider_bill','manual_pdf_confirmation','manual_bank_confirmation','calculated_transactions'));
alter table public.card_invoices drop constraint if exists card_invoices_purchase_count_source_check;
alter table public.card_invoices add constraint card_invoices_purchase_count_source_check
  check(purchase_count_source is null or purchase_count_source in
    ('provider_bill','complete_transactions','persisted_purchases_backfill','last_reliable','unavailable','pdf'));
alter table public.credit_cards drop constraint if exists credit_cards_dates_source_check;
alter table public.credit_cards add constraint credit_cards_dates_source_check
  check(dates_source in ('provider_bill','pluggy','manual','estimated','pdf_confirmed'));
alter table public.invoice_documents drop constraint if exists invoice_documents_bill_fk;
alter table public.invoice_documents
  add constraint invoice_documents_bill_fk foreign key(bill_id) references public.card_invoices(id) on delete set null;

create table if not exists public.invoice_entries(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.card_invoices(id) on delete cascade,
  document_id uuid not null references public.invoice_documents(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  transaction_date date,
  posting_date date,
  description_raw text not null,
  description_normalized text not null,
  merchant_normalized text,
  amount numeric(15,2) not null,
  currency_code char(3) not null default 'BRL',
  entry_type text not null check(entry_type in ('purchase','installment_purchase','credit','refund','payment','fee','interest','tax','previous_balance','adjustment','unknown')),
  card_last_four char(4),
  installment_number integer,
  installment_total integer,
  installment_text text,
  category_id uuid references public.financial_categories(id) on delete set null,
  provider_transaction_id text,
  linked_installment_plan_id uuid,
  linked_installment_occurrence_id uuid,
  confidence numeric(5,4) not null default 0 check(confidence between 0 and 1),
  review_status text not null default 'pending' check(review_status in ('pending','approved','edited','ignored')),
  is_ignored boolean not null default false,
  source_line_number integer,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(installment_number is null or installment_number >= 1),
  check(installment_total is null or (installment_total >= coalesce(installment_number,1) and installment_total <= 120))
);

create table if not exists public.card_installment_plans(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  card_last_four char(4),
  merchant_normalized text not null,
  description_reference text not null,
  installment_amount numeric(15,2) not null check(installment_amount > 0),
  currency_code char(3) not null default 'BRL',
  total_installments integer not null check(total_installments between 2 and 120),
  first_known_installment integer not null check(first_known_installment >= 1),
  latest_known_installment integer not null check(latest_known_installment >= 1),
  paid_installments integer not null default 0 check(paid_installments >= 0),
  posted_installments integer not null default 0 check(posted_installments >= 0),
  remaining_installments integer not null check(remaining_installments >= 0),
  estimated_first_competence date not null,
  estimated_last_competence date not null,
  status text not null default 'active' check(status in ('active','completed','cancelled','disputed','uncertain')),
  confidence numeric(5,4) not null default 0 check(confidence between 0 and 1),
  matching_fingerprint text not null,
  manually_reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,card_id,matching_fingerprint)
);

create table if not exists public.card_installment_occurrences(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  installment_plan_id uuid not null references public.card_installment_plans(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  bill_id uuid references public.card_invoices(id) on delete set null,
  invoice_entry_id uuid references public.invoice_entries(id) on delete set null,
  competence_month date not null,
  installment_number integer not null check(installment_number >= 1),
  total_installments integer not null check(total_installments between installment_number and 120),
  amount numeric(15,2) not null check(amount > 0),
  status text not null check(status in ('projected','posted','confirmed','paid','cancelled','skipped','disputed')),
  due_date date,
  source text not null check(source in ('pdf','manual','pluggy','projection')),
  confidence numeric(5,4) not null default 0 check(confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(installment_plan_id,installment_number)
);

alter table public.invoice_entries
  drop constraint if exists invoice_entries_plan_fk,
  drop constraint if exists invoice_entries_occurrence_fk;
alter table public.invoice_entries
  add constraint invoice_entries_plan_fk foreign key(linked_installment_plan_id) references public.card_installment_plans(id) on delete set null,
  add constraint invoice_entries_occurrence_fk foreign key(linked_installment_occurrence_id) references public.card_installment_occurrences(id) on delete set null;

create table if not exists public.invoice_processing_versions(
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.invoice_documents(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  parser_name text not null,
  parser_version text not null,
  parsed_payload jsonb not null,
  confidence numeric(5,4),
  created_at timestamptz not null default now(),
  unique(document_id,version)
);

do $$ declare t text; begin
  foreach t in array array['invoice_documents','invoice_entries','card_installment_plans','card_installment_occurrences','invoice_processing_versions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop trigger if exists %I_set_updated_at on public.%I',t,t);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;

drop policy if exists invoice_documents_owner on public.invoice_documents;
drop policy if exists invoice_entries_owner on public.invoice_entries;
drop policy if exists card_installment_plans_owner on public.card_installment_plans;
drop policy if exists card_installment_occurrences_owner on public.card_installment_occurrences;
drop policy if exists invoice_processing_versions_owner on public.invoice_processing_versions;
create policy invoice_documents_owner on public.invoice_documents for all to authenticated
  using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy invoice_entries_owner on public.invoice_entries for all to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy card_installment_plans_owner on public.card_installment_plans for all to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy card_installment_occurrences_owner on public.card_installment_occurrences for all to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy invoice_processing_versions_owner on public.invoice_processing_versions for all to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());

drop policy if exists financial_documents_select on storage.objects;
drop policy if exists financial_documents_insert on storage.objects;
drop policy if exists financial_documents_delete on storage.objects;
create policy financial_documents_select on storage.objects for select to authenticated
  using(bucket_id='financial-documents' and (storage.foldername(name))[2]=auth.uid()::text);
create policy financial_documents_insert on storage.objects for insert to authenticated
  with check(bucket_id='financial-documents' and (storage.foldername(name))[2]=auth.uid()::text);
create policy financial_documents_delete on storage.objects for delete to authenticated
  using(bucket_id='financial-documents' and (storage.foldername(name))[2]=auth.uid()::text);

create index if not exists invoice_documents_owner_status on public.invoice_documents(user_id,processing_status,created_at desc);
create index if not exists invoice_entries_bill on public.invoice_entries(bill_id,transaction_date,id);
create index if not exists installment_occurrences_projection on public.card_installment_occurrences(owner_id,competence_month,status);

grant select,insert,update,delete on public.invoice_documents,public.invoice_entries,
  public.card_installment_plans,public.card_installment_occurrences,public.invoice_processing_versions to authenticated;

create or replace function public.confirm_invoice_pdf_import(p_document_id uuid,p_review jsonb)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  doc public.invoice_documents%rowtype;
  card public.credit_cards%rowtype;
  v_bill_id uuid;
  entry jsonb;
  entry_id uuid;
  plan_id uuid;
  occurrence_id uuid;
  fingerprint text;
  official numeric(15,2);
  reference_month date;
  due_date date;
  closing_date date;
  cycle_start date;
  cycle_end date;
  entry_count integer:=0;
  plan_count integer:=0;
  occurrence_count integer:=0;
  n integer;
  current_n integer;
  total_n integer;
  competence date;
  projected_due date;
  installment_amount numeric(15,2);
  provider_tx_id text;
  recon jsonb:=p_review->'reconciliation';
begin
  select * into doc from public.invoice_documents
  where id=p_document_id and user_id=auth.uid() and deleted_at is null
  for update;
  if doc.id is null then raise exception 'invoice_document_not_found'; end if;
  if doc.processing_status not in ('parsed','needs_review') then raise exception 'invoice_document_not_reviewable'; end if;

  select * into card from public.credit_cards
  where id=doc.card_id and owner_id=auth.uid() and status='active';
  if card.id is null then raise exception 'invoice_card_not_authorized'; end if;

  due_date:=(p_review->'parsed'->>'dueDate')::date;
  closing_date:=coalesce((p_review->'parsed'->>'closingDate')::date,due_date-interval '10 days');
  cycle_end:=coalesce((p_review->'parsed'->>'cycleEndDate')::date,closing_date);
  cycle_start:=coalesce((p_review->'parsed'->>'cycleStartDate')::date,(cycle_end-interval '1 month'+interval '1 day')::date);
  reference_month:=date_trunc('month',due_date)::date;
  official:=round(((p_review->'parsed'->>'officialTotalCents')::numeric)/100,2);

  insert into public.card_invoices(
    card_id,owner_id,workspace_id,visibility,reference_month,cycle_start_date,cycle_end_date,
    closing_date,due_date,total_amount,manual_invoice_total,current_display_total,last_reliable_invoice_total,
    calculated_invoice_total,official_total,identified_entries_total,credits_total,payments_total,
    finance_charges_total,previous_balance,reconciliation_difference,reconciliation_status,
    status,total_source,source,document_id,currency_code,confidence,confirmed_by_user,
    data_completeness,last_complete_sync_at
  ) values(
    card.id,card.owner_id,card.workspace_id,card.visibility,reference_month,cycle_start,cycle_end,
    closing_date,due_date,official,official,official,official,
    round(coalesce((recon->>'reconstructedTotalCents')::numeric,0)/100,2),official,
    round(coalesce((recon->>'purchasesCents')::numeric,0)/100,2),
    round(coalesce((recon->>'creditsCents')::numeric,0)/100,2),
    round(coalesce((recon->>'paymentsCents')::numeric,0)/100,2),
    round(coalesce((recon->>'financeChargesCents')::numeric,0)/100,2),
    round(coalesce((recon->>'previousBalanceCents')::numeric,0)/100,2),
    round(coalesce((recon->>'differenceCents')::numeric,0)/100,2),
    case when abs(coalesce((recon->>'differenceCents')::numeric,0))<=1 then 'matched' else 'divergent' end,
    'closed','manual_pdf_confirmation','pdf',doc.id,coalesce(p_review->'parsed'->>'currencyCode','BRL'),
    (p_review->'parsed'->>'confidence')::numeric,true,'complete',now()
  )
  on conflict(card_id,reference_month) do update set
    document_id=excluded.document_id,manual_invoice_total=excluded.manual_invoice_total,
    official_total=excluded.official_total,total_amount=excluded.total_amount,
    current_display_total=excluded.current_display_total,last_reliable_invoice_total=excluded.last_reliable_invoice_total,
    calculated_invoice_total=excluded.calculated_invoice_total,
    identified_entries_total=excluded.identified_entries_total,credits_total=excluded.credits_total,
    payments_total=excluded.payments_total,finance_charges_total=excluded.finance_charges_total,
    previous_balance=excluded.previous_balance,reconciliation_difference=excluded.reconciliation_difference,
    reconciliation_status=excluded.reconciliation_status,total_source='manual_pdf_confirmation',
    source='pdf',confidence=excluded.confidence,confirmed_by_user=true,data_completeness='complete',
    last_complete_sync_at=now(),cycle_start_date=excluded.cycle_start_date,
    cycle_end_date=excluded.cycle_end_date,closing_date=excluded.closing_date,due_date=excluded.due_date
  returning id into v_bill_id;

  delete from public.invoice_entries where document_id=doc.id;

  for entry in select value from jsonb_array_elements(p_review->'parsed'->'entries')
  loop
    if coalesce((entry->>'isIgnored')::boolean,false) then continue; end if;
    entry_id:=coalesce((entry->>'id')::uuid,gen_random_uuid());
    select purchase.external_id into provider_tx_id
    from public.card_purchases purchase
    where purchase.card_id=doc.card_id
      and purchase.status<>'cancelled'
      and purchase.purchase_date between nullif(entry->>'transactionDate','')::date-2
        and nullif(entry->>'transactionDate','')::date+2
      and abs(abs(purchase.installment_amount)-abs(round((entry->>'amountCents')::numeric/100,2)))<=0.01
      and (
        upper(purchase.description)=upper(entry->>'descriptionRaw')
        or upper(purchase.description) like '%'||upper(left(entry->>'merchantNormalized',24))||'%'
      )
    order by case when purchase.purchase_date=nullif(entry->>'transactionDate','')::date then 0 else 1 end
    limit 1;
    insert into public.invoice_entries(
      id,workspace_id,owner_id,bill_id,document_id,card_id,transaction_date,posting_date,
      description_raw,description_normalized,merchant_normalized,amount,currency_code,entry_type,
      card_last_four,installment_number,installment_total,installment_text,provider_transaction_id,confidence,review_status,
      is_ignored,source_line_number
    ) values(
      entry_id,doc.workspace_id,doc.user_id,v_bill_id,doc.id,doc.card_id,
      nullif(entry->>'transactionDate','')::date,nullif(entry->>'postingDate','')::date,
      entry->>'descriptionRaw',entry->>'descriptionNormalized',entry->>'merchantNormalized',
      round((entry->>'amountCents')::numeric/100,2),coalesce(entry->>'currencyCode','BRL'),
      entry->>'entryType',nullif(entry->>'cardLastFour',''),
      nullif(entry->'installment'->>'current','')::integer,
      nullif(entry->'installment'->>'total','')::integer,
      entry->'installment'->>'raw',provider_tx_id,coalesce((entry->>'confidence')::numeric,0),
      case when entry->>'reviewStatus'='edited' then 'edited' else 'approved' end,
      false,nullif(entry->>'sourceLineNumber','')::integer
    );
    entry_count:=entry_count+1;

    if entry->>'entryType'='installment_purchase' and entry->'installment' is not null then
      current_n:=(entry->'installment'->>'current')::integer;
      total_n:=(entry->'installment'->>'total')::integer;
      installment_amount:=abs(round((entry->>'amountCents')::numeric/100,2));
      fingerprint:=encode(extensions.digest(
        concat_ws('|',doc.workspace_id,doc.card_id,coalesce(entry->>'cardLastFour',''),
          entry->>'merchantNormalized',installment_amount,total_n,coalesce(entry->>'currencyCode','BRL')),
        'sha256'),'hex');
      insert into public.card_installment_plans(
        workspace_id,owner_id,card_id,card_last_four,merchant_normalized,description_reference,
        installment_amount,currency_code,total_installments,first_known_installment,
        latest_known_installment,posted_installments,remaining_installments,
        estimated_first_competence,estimated_last_competence,status,confidence,matching_fingerprint,manually_reviewed
      ) values(
        doc.workspace_id,doc.user_id,doc.card_id,nullif(entry->>'cardLastFour',''),
        entry->>'merchantNormalized',entry->>'descriptionRaw',installment_amount,
        coalesce(entry->>'currencyCode','BRL'),total_n,current_n,current_n,current_n,total_n-current_n,
        (reference_month-(current_n-1)*interval '1 month')::date,
        (reference_month+(total_n-current_n)*interval '1 month')::date,
        case when current_n=total_n then 'completed' else 'active' end,
        coalesce((entry->'installment'->>'confidence')::numeric,0),fingerprint,true
      )
      on conflict(workspace_id,card_id,matching_fingerprint) do update set
        latest_known_installment=greatest(public.card_installment_plans.latest_known_installment,excluded.latest_known_installment),
        posted_installments=greatest(public.card_installment_plans.posted_installments,excluded.posted_installments),
        remaining_installments=greatest(0,excluded.total_installments-greatest(public.card_installment_plans.latest_known_installment,excluded.latest_known_installment)),
        status=case when greatest(public.card_installment_plans.latest_known_installment,excluded.latest_known_installment)>=excluded.total_installments then 'completed' else 'active' end,
        confidence=greatest(public.card_installment_plans.confidence,excluded.confidence),
        description_reference=excluded.description_reference
      returning id into plan_id;
      plan_count:=plan_count+1;

      for n in current_n..total_n loop
        competence:=(reference_month+(n-current_n)*interval '1 month')::date;
        projected_due:=(date_trunc('month',competence)+(least(extract(day from due_date)::integer,
          extract(day from (date_trunc('month',competence)+interval '1 month'-interval '1 day'))::integer)-1)*interval '1 day')::date;
        insert into public.card_installment_occurrences(
          workspace_id,owner_id,installment_plan_id,card_id,bill_id,invoice_entry_id,
          competence_month,installment_number,total_installments,amount,status,due_date,source,confidence
        ) values(
          doc.workspace_id,doc.user_id,plan_id,doc.card_id,
          case when n=current_n then v_bill_id else null end,case when n=current_n then entry_id else null end,
          date_trunc('month',competence)::date,n,total_n,installment_amount,
          case when n=current_n then 'posted' else 'projected' end,projected_due,
          case when n=current_n then 'pdf' else 'projection' end,
          coalesce((entry->'installment'->>'confidence')::numeric,0)
        )
        on conflict(installment_plan_id,installment_number) do update set
          bill_id=coalesce(excluded.bill_id,public.card_installment_occurrences.bill_id),
          invoice_entry_id=coalesce(excluded.invoice_entry_id,public.card_installment_occurrences.invoice_entry_id),
          status=case when excluded.status='posted' then 'posted' else public.card_installment_occurrences.status end,
          due_date=excluded.due_date
        returning id into occurrence_id;
        occurrence_count:=occurrence_count+1;
        if n=current_n then
          update public.invoice_entries set linked_installment_plan_id=plan_id,
            linked_installment_occurrence_id=occurrence_id where id=entry_id;
        end if;
      end loop;
    end if;
  end loop;

  update public.card_invoices set
    purchase_count=entry_count,last_reliable_purchase_count=entry_count,
    purchase_count_source='pdf',updated_at=now()
  where id=v_bill_id;

  update public.credit_cards set
    closing_day=extract(day from closing_date)::integer,
    due_day=extract(day from due_date)::integer,
    dates_source='pdf_confirmed',
    updated_at=now()
  where id=card.id;

  update public.invoice_documents set bill_id=v_bill_id,
    parsed_payload=p_review,processing_status='confirmed',review_status='approved',
    imported_at=coalesce(imported_at,now()),confirmed_at=now(),
    processing_error_code=null,processing_error_message=null
  where id=doc.id;

  return jsonb_build_object('documentId',doc.id,'billId',v_bill_id,'entriesCreated',entry_count,
    'installmentPlansCreated',plan_count,'occurrencesCreated',occurrence_count);
end
$$;

grant execute on function public.confirm_invoice_pdf_import(uuid,jsonb) to authenticated;
