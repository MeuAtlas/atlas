-- Preserve the account-currency amount separately from the original
-- transaction currency. Existing amounts are retained and backfilled safely.

alter table public.card_purchases
  add column if not exists amount_brl numeric(15,2),
  add column if not exists provider_signed_amount numeric(15,2),
  add column if not exists original_currency_code text,
  add column if not exists exchange_rate numeric(18,8),
  add column if not exists foreign_iof_amount numeric(15,2),
  add column if not exists conversion_source text,
  add column if not exists converted_at timestamptz,
  add column if not exists posting_date date;

alter table public.invoice_entries
  add column if not exists amount_brl numeric(15,2),
  add column if not exists original_amount numeric(15,2),
  add column if not exists original_currency_code text,
  add column if not exists exchange_rate numeric(18,8),
  add column if not exists foreign_iof_amount numeric(15,2),
  add column if not exists conversion_source text,
  add column if not exists converted_at timestamptz,
  add column if not exists related_foreign_entry_id uuid
    references public.invoice_entries(id) on delete set null;

alter table public.financial_transactions
  add column if not exists amount_brl numeric(15,2),
  add column if not exists original_currency_code text,
  add column if not exists exchange_rate numeric(18,8),
  add column if not exists foreign_iof_amount numeric(15,2),
  add column if not exists conversion_source text,
  add column if not exists converted_at timestamptz;

update public.card_purchases
set amount_brl=round(abs(installment_amount),2),
    provider_signed_amount=coalesce(provider_signed_amount,original_amount)
where amount_brl is null
   or provider_signed_amount is null;

update public.invoice_entries
set amount_brl=round(abs(amount),2)
where amount_brl is null;

update public.financial_transactions
set amount_brl=round(abs(amount),2)
where amount_brl is null;

alter table public.card_purchases
  drop constraint if exists card_purchases_original_currency_code_check,
  add constraint card_purchases_original_currency_code_check
    check(original_currency_code is null or original_currency_code ~ '^[A-Z]{3}$'),
  drop constraint if exists card_purchases_foreign_amounts_check,
  add constraint card_purchases_foreign_amounts_check
    check(
      amount_brl is null or amount_brl >= 0
    ) not valid,
  drop constraint if exists card_purchases_original_amount_positive_check,
  add constraint card_purchases_original_amount_positive_check
    check(original_amount is null or original_amount > 0) not valid,
  drop constraint if exists card_purchases_exchange_rate_positive_check,
  add constraint card_purchases_exchange_rate_positive_check
    check(exchange_rate is null or exchange_rate > 0),
  drop constraint if exists card_purchases_foreign_iof_positive_check,
  add constraint card_purchases_foreign_iof_positive_check
    check(foreign_iof_amount is null or foreign_iof_amount >= 0),
  drop constraint if exists card_purchases_conversion_source_check,
  add constraint card_purchases_conversion_source_check
    check(conversion_source is null or conversion_source in(
      'pdf','pluggy','manual','derived','unknown'
    ));

alter table public.invoice_entries
  drop constraint if exists invoice_entries_original_currency_code_check,
  add constraint invoice_entries_original_currency_code_check
    check(original_currency_code is null or original_currency_code ~ '^[A-Z]{3}$'),
  drop constraint if exists invoice_entries_original_amount_positive_check,
  add constraint invoice_entries_original_amount_positive_check
    check(original_amount is null or original_amount > 0),
  drop constraint if exists invoice_entries_exchange_rate_positive_check,
  add constraint invoice_entries_exchange_rate_positive_check
    check(exchange_rate is null or exchange_rate > 0),
  drop constraint if exists invoice_entries_foreign_iof_positive_check,
  add constraint invoice_entries_foreign_iof_positive_check
    check(foreign_iof_amount is null or foreign_iof_amount >= 0),
  drop constraint if exists invoice_entries_conversion_source_check,
  add constraint invoice_entries_conversion_source_check
    check(conversion_source is null or conversion_source in(
      'pdf','pluggy','manual','derived','unknown'
    ));

create index if not exists card_purchases_foreign_currency_idx
  on public.card_purchases(owner_id,original_currency_code,competence_date)
  where original_currency_code is not null;
create index if not exists invoice_entries_foreign_currency_idx
  on public.invoice_entries(owner_id,original_currency_code,transaction_date)
  where original_currency_code is not null;

create or replace function public.enrich_invoice_foreign_values(
  p_document_id uuid,
  p_entries jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  doc public.invoice_documents%rowtype;
  entry jsonb;
  enriched_entries integer:=0;
  enriched_purchases integer:=0;
  linked_iofs integer:=0;
begin
  select * into doc
  from public.invoice_documents
  where id=p_document_id
    and user_id=auth.uid()
    and deleted_at is null;
  if doc.id is null then raise exception 'invoice_document_not_authorized'; end if;

  for entry in select value from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb))
  loop
    if coalesce((entry->>'isIgnored')::boolean,false) then continue; end if;
    update public.invoice_entries invoice_entry
    set amount_brl=round(abs((entry->>'amountCents')::numeric)/100,2),
        original_amount=case
          when coalesce((entry->>'foreignAmountCents')::numeric,0)>0
          then round(abs((entry->>'foreignAmountCents')::numeric)/100,2)
          else null end,
        original_currency_code=case
          when coalesce((entry->>'foreignAmountCents')::numeric,0)>0
          then upper(nullif(entry->>'foreignCurrencyCode',''))
          else null end,
        exchange_rate=case
          when coalesce((entry->>'exchangeRate')::numeric,0)>0
          then (entry->>'exchangeRate')::numeric
          else null end,
        foreign_iof_amount=case
          when coalesce((entry->>'iofAmountCents')::numeric,0)>0
          then round((entry->>'iofAmountCents')::numeric/100,2)
          else null end,
        conversion_source=case
          when coalesce((entry->>'foreignAmountCents')::numeric,0)>0
          then 'pdf' else null end,
        converted_at=case
          when coalesce((entry->>'foreignAmountCents')::numeric,0)>0
          then now() else null end,
        related_foreign_entry_id=nullif(entry->>'relatedForeignEntryId','')::uuid
    where invoice_entry.id=(entry->>'id')::uuid
      and invoice_entry.document_id=p_document_id;
    if found and coalesce((entry->>'foreignAmountCents')::numeric,0)>0 then
      enriched_entries:=enriched_entries+1;
    end if;
    if found and nullif(entry->>'relatedForeignEntryId','') is not null then
      linked_iofs:=linked_iofs+1;
    end if;
  end loop;

  with matched as(
    select purchase.id purchase_id,invoice_entry.*
    from public.invoice_entries invoice_entry
    join public.card_purchases purchase
      on purchase.owner_id=doc.user_id
     and purchase.card_id=invoice_entry.card_id
     and purchase.external_id=invoice_entry.provider_transaction_id
    where invoice_entry.document_id=p_document_id
      and invoice_entry.original_currency_code is not null
  ), updated as(
    update public.card_purchases purchase
    set amount_brl=matched.amount_brl,
        installment_amount=matched.amount_brl,
        total_amount=case
          when coalesce(purchase.installment_count,1)>1
          then purchase.total_amount else matched.amount_brl end,
        provider_signed_amount=coalesce(
          purchase.provider_signed_amount,purchase.original_amount
        ),
        original_amount=matched.original_amount,
        original_currency_code=matched.original_currency_code,
        exchange_rate=matched.exchange_rate,
        foreign_iof_amount=matched.foreign_iof_amount,
        conversion_source='pdf',
        converted_at=now()
    from matched
    where purchase.id=matched.purchase_id
    returning purchase.id
  )
  select count(*) into enriched_purchases from updated;

  return jsonb_build_object(
    'internationalEntriesEnriched',enriched_entries,
    'cardPurchasesEnriched',enriched_purchases,
    'iofsLinked',linked_iofs
  );
end
$$;

revoke all on function public.enrich_invoice_foreign_values(uuid,jsonb)
  from public;
grant execute on function public.enrich_invoice_foreign_values(uuid,jsonb)
  to authenticated;

create or replace function public.backfill_foreign_card_movements(
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  pdf_found integer:=0;
  pdf_updated integer:=0;
  pdf_purchases_enriched integer:=0;
  pluggy_found integer:=0;
  existing_found integer:=0;
  values_recovered integer:=0;
  insufficient integer:=0;
  iofs_linked integer:=0;
  currencies text[]:='{}';
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select count(*) into pdf_found
  from public.invoice_documents document
  cross join lateral jsonb_array_elements(
    coalesce(document.parsed_payload->'parsed'->'entries','[]'::jsonb)
  ) entry
  where document.user_id=auth.uid()
    and document.deleted_at is null
    and coalesce((entry->>'foreignAmountCents')::numeric,0)>0
    and nullif(entry->>'foreignCurrencyCode','') is not null;

  select count(*) into pluggy_found
  from public.card_purchases purchase
  where purchase.owner_id=auth.uid()
    and purchase.source='pluggy'
    and upper(coalesce(
      purchase.original_currency_code,
      purchase.currency,
      purchase.provider_metadata->>'currencyCode',
      'BRL'
    ))<>'BRL'
    and coalesce(
      purchase.amount_brl,
      nullif((purchase.provider_metadata->>'amountInAccountCurrency')::numeric,0),
      purchase.installment_amount
    )>0;

  select count(*) into existing_found
  from public.card_purchases purchase
  where purchase.owner_id=auth.uid()
    and purchase.original_amount>0
    and upper(coalesce(
      purchase.original_currency_code,purchase.currency,'BRL'
    ))<>'BRL'
    and coalesce(purchase.amount_brl,purchase.installment_amount)>0;

  select count(*) into insufficient
  from public.card_purchases purchase
  where purchase.owner_id=auth.uid()
    and upper(coalesce(
      purchase.original_currency_code,purchase.currency,'BRL'
    ))<>'BRL'
    and (
      coalesce(purchase.original_amount,0)<=0
      or coalesce(purchase.amount_brl,purchase.installment_amount,0)<=0
    );

  select coalesce(array_agg(distinct currency_code order by currency_code),'{}')
  into currencies
  from(
    select upper(entry->>'foreignCurrencyCode') currency_code
    from public.invoice_documents document
    cross join lateral jsonb_array_elements(
      coalesce(document.parsed_payload->'parsed'->'entries','[]'::jsonb)
    ) entry
    where document.user_id=auth.uid()
      and document.deleted_at is null
      and coalesce((entry->>'foreignAmountCents')::numeric,0)>0
    union
    select upper(coalesce(
      purchase.original_currency_code,purchase.currency
    ))
    from public.card_purchases purchase
    where purchase.owner_id=auth.uid()
      and upper(coalesce(
        purchase.original_currency_code,purchase.currency,'BRL'
      ))<>'BRL'
  ) identified
  where currency_code~'^[A-Z]{3}$';

  if p_apply then
    with candidates as(
      select purchase.id,
        upper(coalesce(
          purchase.original_currency_code,
          purchase.currency,
          purchase.provider_metadata->>'currencyCode'
        )) original_currency,
        abs(coalesce(
          purchase.provider_signed_amount,
          purchase.original_amount
        )) recovered_original,
        abs(coalesce(
          nullif((purchase.provider_metadata->>'amountInAccountCurrency')::numeric,0),
          purchase.amount_brl,
          purchase.installment_amount
        )) recovered_brl
      from public.card_purchases purchase
      where purchase.owner_id=auth.uid()
        and upper(coalesce(
          purchase.original_currency_code,
          purchase.currency,
          purchase.provider_metadata->>'currencyCode',
          'BRL'
        ))<>'BRL'
    ), updated as(
      update public.card_purchases purchase
      set provider_signed_amount=coalesce(
            purchase.provider_signed_amount,purchase.original_amount
          ),
          original_amount=case when candidate.recovered_original>0
            then candidate.recovered_original else purchase.original_amount end,
          original_currency_code=case
            when candidate.original_currency~'^[A-Z]{3}$'
            then candidate.original_currency
            else purchase.original_currency_code end,
          amount_brl=case when candidate.recovered_brl>0
            then candidate.recovered_brl else purchase.amount_brl end,
          installment_amount=case when candidate.recovered_brl>0
            then candidate.recovered_brl else purchase.installment_amount end,
          conversion_source=case
            when purchase.conversion_source in('pdf','manual')
            then purchase.conversion_source
            when nullif(
              purchase.provider_metadata->>'amountInAccountCurrency',''
            ) is not null then 'pluggy'
            else coalesce(purchase.conversion_source,'unknown') end,
          converted_at=case when candidate.recovered_brl>0
            then coalesce(purchase.converted_at,now())
            else purchase.converted_at end
      from candidates candidate
      where purchase.id=candidate.id
        and candidate.recovered_original>0
        and candidate.recovered_brl>0
      returning purchase.id
    )
    select count(*) into values_recovered from updated;

    with documents as(
      select document.id,document.parsed_payload->'parsed'->'entries' entries
      from public.invoice_documents document
      where document.user_id=auth.uid()
        and document.deleted_at is null
    ), parsed as(
      select document.id document_id,entry
      from documents document
      cross join lateral jsonb_array_elements(
        coalesce(document.entries,'[]'::jsonb)
      ) entry
    ), updated as(
      update public.invoice_entries invoice_entry
      set amount_brl=round(abs((parsed.entry->>'amountCents')::numeric)/100,2),
          original_amount=round(
            abs((parsed.entry->>'foreignAmountCents')::numeric)/100,2
          ),
          original_currency_code=upper(
            parsed.entry->>'foreignCurrencyCode'
          ),
          exchange_rate=nullif(
            parsed.entry->>'exchangeRate',''
          )::numeric,
          foreign_iof_amount=case
            when coalesce(
              (parsed.entry->>'iofAmountCents')::numeric,0
            )>0 then round(
              (parsed.entry->>'iofAmountCents')::numeric/100,2
            ) else null end,
          conversion_source='pdf',
          converted_at=coalesce(invoice_entry.converted_at,now()),
          related_foreign_entry_id=nullif(
            parsed.entry->>'relatedForeignEntryId',''
          )::uuid
      from parsed
      where invoice_entry.document_id=parsed.document_id
        and invoice_entry.id=(parsed.entry->>'id')::uuid
        and coalesce(
          (parsed.entry->>'foreignAmountCents')::numeric,0
        )>0
      returning invoice_entry.id
    )
    select count(*) into pdf_updated from updated;

    with matched as(
      select purchase.id purchase_id,invoice_entry.*
      from public.invoice_entries invoice_entry
      join public.card_purchases purchase
        on purchase.owner_id=auth.uid()
       and purchase.card_id=invoice_entry.card_id
       and purchase.external_id=invoice_entry.provider_transaction_id
      where invoice_entry.owner_id=auth.uid()
        and invoice_entry.original_currency_code is not null
        and invoice_entry.amount_brl>0
        and invoice_entry.original_amount>0
    ), updated as(
      update public.card_purchases purchase
      set amount_brl=matched.amount_brl,
          installment_amount=matched.amount_brl,
          total_amount=case
            when coalesce(purchase.installment_count,1)>1
            then purchase.total_amount else matched.amount_brl end,
          provider_signed_amount=coalesce(
            purchase.provider_signed_amount,purchase.original_amount
          ),
          original_amount=matched.original_amount,
          original_currency_code=matched.original_currency_code,
          exchange_rate=matched.exchange_rate,
          foreign_iof_amount=matched.foreign_iof_amount,
          conversion_source='pdf',
          converted_at=coalesce(purchase.converted_at,now())
      from matched
      where purchase.id=matched.purchase_id
      returning purchase.id
    )
    select count(*) into pdf_purchases_enriched from updated;

    select count(*) into iofs_linked
    from public.invoice_entries entry
    where entry.owner_id=auth.uid()
      and entry.related_foreign_entry_id is not null;
  else
    select count(*) into iofs_linked
    from public.invoice_documents document
    cross join lateral jsonb_array_elements(
      coalesce(document.parsed_payload->'parsed'->'entries','[]'::jsonb)
    ) entry
    where document.user_id=auth.uid()
      and document.deleted_at is null
      and nullif(entry->>'relatedForeignEntryId','') is not null;
  end if;

  return jsonb_build_object(
    'mode',case when p_apply then 'apply' else 'dry-run' end,
    'internationalFound',pdf_found+pluggy_found+existing_found,
    'pdfInternationalFound',pdf_found,
    'pdfEntriesUpdated',pdf_updated,
    'pdfPurchasesEnriched',pdf_purchases_enriched,
    'pluggyInternationalFound',pluggy_found,
    'existingFieldsFound',existing_found,
    'originalValuesRecovered',values_recovered,
    'currenciesIdentified',to_jsonb(currencies),
    'insufficientInformation',insufficient,
    'iofsLinked',iofs_linked
  );
end
$$;

revoke all on function public.backfill_foreign_card_movements(boolean)
  from public;
grant execute on function public.backfill_foreign_card_movements(boolean)
  to authenticated;

comment on column public.card_purchases.amount_brl is
  'Amount posted to the BRL card invoice; never the original foreign amount.';
comment on column public.card_purchases.original_amount is
  'Positive amount in original foreign currency when explicitly known.';
comment on column public.card_purchases.provider_signed_amount is
  'Original signed provider amount retained for credit/debit diagnostics.';
