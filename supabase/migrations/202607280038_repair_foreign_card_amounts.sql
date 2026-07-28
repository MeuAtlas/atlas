-- Foreign purchases must never reuse their original-currency amount as BRL.
-- This migration is additive, preserves provider/PDF metadata and exposes an
-- authenticated idempotent dry-run/apply repair.

alter table public.card_purchases
  add column if not exists conversion_confidence numeric(5,4),
  add column if not exists exchange_rate_source text,
  add column if not exists related_foreign_purchase_id uuid
    references public.card_purchases(id) on delete set null,
  add column if not exists entry_type text;

alter table public.card_purchases
  drop constraint if exists card_purchases_conversion_confidence_check,
  add constraint card_purchases_conversion_confidence_check
    check(
      conversion_confidence is null or
      conversion_confidence between 0 and 1
    ),
  drop constraint if exists card_purchases_exchange_rate_source_check,
  add constraint card_purchases_exchange_rate_source_check
    check(
      exchange_rate_source is null or
      exchange_rate_source in('pluggy','pdf','manual','derived')
    ),
  drop constraint if exists card_purchases_entry_type_check,
  add constraint card_purchases_entry_type_check
    check(
      entry_type is null or
      entry_type in(
        'purchase','installment_purchase','credit','refund','fee',
        'interest','tax','adjustment'
      )
    ),
  drop constraint if exists card_purchases_role_check,
  drop constraint if exists card_purchases_transaction_role_check,
  add constraint card_purchases_role_check
    check(
      transaction_role in(
        'consumption','cash_flow','invoice_payment','transfer','refund',
        'adjustment','foreign_transaction_tax'
      )
    );

create index if not exists card_purchases_related_foreign_idx
  on public.card_purchases(owner_id,related_foreign_purchase_id)
  where related_foreign_purchase_id is not null;

create or replace function public.backfill_foreign_card_amounts_v2(
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  international_found integer:=0;
  converted_recovered integer:=0;
  corrected integer:=0;
  suspicious_cleared integer:=0;
  iofs_linked integer:=0;
  still_missing integer:=0;
  source_counts jsonb:='{}'::jsonb;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  with candidates as(
    select
      purchase.id,
      coalesce(
        pdf.amount_brl,
        case
          when coalesce(
            purchase.provider_metadata->>'amountInAccountCurrency',
            purchase.provider_metadata->>'convertedAmount',
            purchase.provider_metadata->>'localAmount'
          )~'^-?[0-9]+([.][0-9]+)?$'
          then abs(coalesce(
            purchase.provider_metadata->>'amountInAccountCurrency',
            purchase.provider_metadata->>'convertedAmount',
            purchase.provider_metadata->>'localAmount'
          )::numeric)
        end,
        case when purchase.conversion_source='manual'
          then purchase.amount_brl end,
        case
          when purchase.amount_brl is not null
            and (
              purchase.conversion_source in('pdf','pluggy','manual')
              or purchase.amount_brl is distinct from purchase.original_amount
            )
          then purchase.amount_brl
        end,
        case
          when purchase.exchange_rate>0 and purchase.original_amount>0
          then round(purchase.exchange_rate*purchase.original_amount,2)
        end
      ) recovered_brl,
      case
        when pdf.amount_brl is not null then 'pdf'
        when coalesce(
          purchase.provider_metadata->>'amountInAccountCurrency',
          purchase.provider_metadata->>'convertedAmount',
          purchase.provider_metadata->>'localAmount'
        )~'^-?[0-9]+([.][0-9]+)?$' then 'pluggy'
        when purchase.conversion_source='manual' then 'manual'
        when purchase.amount_brl is not null
          and purchase.amount_brl is distinct from purchase.original_amount
          then coalesce(purchase.conversion_source,'unknown')
        when purchase.exchange_rate>0 then 'derived'
        else 'unknown'
      end recovered_source
    from public.card_purchases purchase
    left join lateral(
      select entry.amount_brl
      from public.invoice_entries entry
      where entry.owner_id=purchase.owner_id
        and entry.card_id=purchase.card_id
        and entry.original_currency_code is not null
        and entry.amount_brl>0
        and (
          entry.provider_transaction_id=purchase.external_id
          or (
            entry.transaction_date between
              purchase.purchase_date-interval '2 days'
              and purchase.purchase_date+interval '2 days'
            and abs(entry.original_amount-purchase.original_amount)<=0.01
          )
        )
      order by
        (entry.provider_transaction_id=purchase.external_id) desc,
        abs(entry.transaction_date-purchase.purchase_date)
      limit 1
    ) pdf on true
    where purchase.owner_id=auth.uid()
      and coalesce(
        purchase.original_currency_code,
        nullif(upper(purchase.currency),'BRL')
      ) is not null
      and coalesce(
        purchase.original_currency_code,
        nullif(upper(purchase.currency),'BRL')
      )<>'BRL'
      and purchase.original_amount>0
  )
  select
    count(*),
    count(*) filter(where recovered_brl>0),
    count(*) filter(where recovered_brl is null),
    coalesce(jsonb_object_agg(recovered_source,source_total),'{}'::jsonb)
  into
    international_found,
    converted_recovered,
    still_missing,
    source_counts
  from(
    select
      candidates.*,
      count(*) over(partition by recovered_source) source_total
    from candidates
  ) counted;

  if p_apply then
    with candidates as(
      select
        purchase.id,
        coalesce(
          pdf.amount_brl,
          case
            when coalesce(
              purchase.provider_metadata->>'amountInAccountCurrency',
              purchase.provider_metadata->>'convertedAmount',
              purchase.provider_metadata->>'localAmount'
            )~'^-?[0-9]+([.][0-9]+)?$'
            then abs(coalesce(
              purchase.provider_metadata->>'amountInAccountCurrency',
              purchase.provider_metadata->>'convertedAmount',
              purchase.provider_metadata->>'localAmount'
            )::numeric)
          end,
          case when purchase.conversion_source='manual'
            then purchase.amount_brl end,
          case
            when purchase.amount_brl is not null
              and (
                purchase.conversion_source in('pdf','pluggy','manual')
                or purchase.amount_brl is distinct from purchase.original_amount
              )
            then purchase.amount_brl
          end,
          case
            when purchase.exchange_rate>0 and purchase.original_amount>0
            then round(purchase.exchange_rate*purchase.original_amount,2)
          end
        ) recovered_brl,
        case
          when pdf.amount_brl is not null then 'pdf'
          when coalesce(
            purchase.provider_metadata->>'amountInAccountCurrency',
            purchase.provider_metadata->>'convertedAmount',
            purchase.provider_metadata->>'localAmount'
          )~'^-?[0-9]+([.][0-9]+)?$' then 'pluggy'
          when purchase.conversion_source='manual' then 'manual'
          when purchase.exchange_rate>0 then 'derived'
          else purchase.conversion_source
        end recovered_source
      from public.card_purchases purchase
      left join lateral(
        select entry.amount_brl
        from public.invoice_entries entry
        where entry.owner_id=purchase.owner_id
          and entry.card_id=purchase.card_id
          and entry.original_currency_code is not null
          and entry.amount_brl>0
          and (
            entry.provider_transaction_id=purchase.external_id
            or (
              entry.transaction_date between
                purchase.purchase_date-interval '2 days'
                and purchase.purchase_date+interval '2 days'
              and abs(entry.original_amount-purchase.original_amount)<=0.01
            )
          )
        order by
          (entry.provider_transaction_id=purchase.external_id) desc,
          abs(entry.transaction_date-purchase.purchase_date)
        limit 1
      ) pdf on true
      where purchase.owner_id=auth.uid()
        and coalesce(
          purchase.original_currency_code,
          nullif(upper(purchase.currency),'BRL')
        ) is not null
        and coalesce(
          purchase.original_currency_code,
          nullif(upper(purchase.currency),'BRL')
        )<>'BRL'
        and purchase.original_amount>0
    ), updated as(
      update public.card_purchases purchase
      set
        amount_brl=candidate.recovered_brl,
        installment_amount=coalesce(
          candidate.recovered_brl,
          purchase.installment_amount
        ),
        total_amount=case
          when coalesce(purchase.installment_count,1)<=1
            and candidate.recovered_brl is not null
          then candidate.recovered_brl
          else purchase.total_amount
        end,
        conversion_source=coalesce(candidate.recovered_source,'unknown'),
        conversion_confidence=case
          when candidate.recovered_source in('pdf','pluggy','manual') then 1
          when candidate.recovered_source='derived' then 0.75
          else purchase.conversion_confidence
        end,
        exchange_rate_source=case
          when candidate.recovered_source='derived' then 'derived'
          when candidate.recovered_source in('pdf','pluggy','manual')
            then candidate.recovered_source
          else purchase.exchange_rate_source
        end,
        converted_at=case when candidate.recovered_brl is not null
          then coalesce(purchase.converted_at,now()) else null end
      from candidates candidate
      where purchase.id=candidate.id
        and (
          purchase.amount_brl is distinct from candidate.recovered_brl
          or purchase.conversion_source is distinct from
            coalesce(candidate.recovered_source,'unknown')
        )
      returning
        purchase.id,
        candidate.recovered_brl is null cleared
    )
    select
      count(*),
      count(*) filter(where cleared)
    into corrected,suspicious_cleared
    from updated;

    with possible as(
      select
        tax.id tax_id,
        foreign_purchase.id foreign_id,
        count(*) over(partition by tax.id) tax_options,
        count(*) over(partition by foreign_purchase.id) purchase_options
      from public.card_purchases tax
      join public.card_purchases foreign_purchase
        on foreign_purchase.owner_id=tax.owner_id
       and foreign_purchase.card_id=tax.card_id
       and foreign_purchase.original_currency_code is not null
       and foreign_purchase.original_currency_code<>'BRL'
       and abs(tax.purchase_date-foreign_purchase.purchase_date)<=2
      where tax.owner_id=auth.uid()
        and tax.related_foreign_purchase_id is null
        and upper(tax.description) like '%IOF%'
        and (
          upper(tax.description) like '%EXTERIOR%'
          or upper(tax.description) like '%INTERNACIONAL%'
        )
    ), linked as(
      update public.card_purchases tax
      set
        related_foreign_purchase_id=possible.foreign_id,
        transaction_role='foreign_transaction_tax',
        entry_type='tax',
        original_amount=null,
        original_currency_code=null
      from possible
      where tax.id=possible.tax_id
        and possible.tax_options=1
        and possible.purchase_options=1
      returning tax.id,possible.foreign_id,tax.amount_brl
    ), enriched as(
      update public.card_purchases foreign_purchase
      set foreign_iof_amount=linked.amount_brl
      from linked
      where foreign_purchase.id=linked.foreign_id
        and linked.amount_brl>0
      returning foreign_purchase.id
    )
    select count(*) into iofs_linked from linked;
  end if;

  return jsonb_build_object(
    'mode',case when p_apply then 'apply' else 'dry-run' end,
    'internationalFound',international_found,
    'convertedRecovered',converted_recovered,
    'corrected',corrected,
    'suspiciousOriginalReusedCleared',suspicious_cleared,
    'iofsLinked',iofs_linked,
    'stillMissingConversion',still_missing,
    'sources',source_counts
  );
end
$$;

revoke all on function public.backfill_foreign_card_amounts_v2(boolean)
  from public;
grant execute on function public.backfill_foreign_card_amounts_v2(boolean)
  to authenticated;

comment on function public.backfill_foreign_card_amounts_v2(boolean) is
  'Idempotent repair that never treats a foreign original amount as BRL.';
