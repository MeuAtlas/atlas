-- A statement may adjust an installment by a few cents (for example after a
-- credit). The amount is mutable evidence and must not identify the plan.
-- Keep the original purchase date, merchant, card and installment count as
-- the stable identity, merge legacy duplicates and update future amounts.

do $repair$
declare
  duplicate_group record;
  canonical_id uuid;
  duplicate_plan record;
begin
  for duplicate_group in
    with identified as (
      select
        plan.*,
        (
          select min(entry.transaction_date)
          from public.invoice_entries entry
          where entry.linked_installment_plan_id=plan.id
        ) as purchase_date_reference
      from public.card_installment_plans plan
      where plan.matching_fingerprint not like 'atlas:manual-plan:%'
    )
    select
      workspace_id,owner_id,card_id,coalesce(card_last_four,'') card_last_four,
      merchant_normalized,total_installments,currency_code,
      purchase_date_reference
    from identified
    where purchase_date_reference is not null
    group by workspace_id,owner_id,card_id,coalesce(card_last_four,''),
      merchant_normalized,total_installments,currency_code,
      purchase_date_reference
    having count(*)>1
  loop
    select plan.id into canonical_id
    from public.card_installment_plans plan
    where plan.workspace_id=duplicate_group.workspace_id
      and plan.owner_id=duplicate_group.owner_id
      and plan.card_id=duplicate_group.card_id
      and coalesce(plan.card_last_four,'')=duplicate_group.card_last_four
      and plan.merchant_normalized=duplicate_group.merchant_normalized
      and plan.total_installments=duplicate_group.total_installments
      and plan.currency_code=duplicate_group.currency_code
      and exists (
        select 1 from public.invoice_entries entry
        where entry.linked_installment_plan_id=plan.id
          and entry.transaction_date=duplicate_group.purchase_date_reference
      )
    order by plan.latest_known_installment desc,plan.updated_at desc,plan.id
    limit 1;

    for duplicate_plan in
      select plan.id
      from public.card_installment_plans plan
      where plan.workspace_id=duplicate_group.workspace_id
        and plan.owner_id=duplicate_group.owner_id
        and plan.card_id=duplicate_group.card_id
        and coalesce(plan.card_last_four,'')=duplicate_group.card_last_four
        and plan.merchant_normalized=duplicate_group.merchant_normalized
        and plan.total_installments=duplicate_group.total_installments
        and plan.currency_code=duplicate_group.currency_code
        and plan.id<>canonical_id
        and exists (
          select 1 from public.invoice_entries entry
          where entry.linked_installment_plan_id=plan.id
            and entry.transaction_date=duplicate_group.purchase_date_reference
        )
    loop
      update public.card_installment_occurrences
      set status='cancelled'
      where installment_plan_id=duplicate_plan.id
        and status='projected';

      update public.card_installment_plans
      set status='cancelled',remaining_installments=0
      where id=duplicate_plan.id;
    end loop;

    update public.card_installment_plans plan set
      first_known_installment=coalesce((
        select min(occurrence.installment_number)
        from public.card_installment_occurrences occurrence
        where occurrence.installment_plan_id=canonical_id
          and occurrence.status in ('posted','confirmed','paid')
      ),plan.first_known_installment),
      latest_known_installment=greatest(plan.latest_known_installment,coalesce((
        select max(occurrence.installment_number)
        from public.card_installment_occurrences occurrence
        where occurrence.installment_plan_id=canonical_id
          and occurrence.status in ('posted','confirmed','paid')
      ),plan.latest_known_installment)),
      posted_installments=greatest(plan.posted_installments,coalesce((
        select max(occurrence.installment_number)
        from public.card_installment_occurrences occurrence
        where occurrence.installment_plan_id=canonical_id
          and occurrence.status in ('posted','confirmed','paid')
      ),plan.posted_installments)),
      remaining_installments=greatest(0,plan.total_installments-greatest(
        plan.latest_known_installment,coalesce((
          select max(occurrence.installment_number)
          from public.card_installment_occurrences occurrence
          where occurrence.installment_plan_id=canonical_id
            and occurrence.status in ('posted','confirmed','paid')
        ),plan.latest_known_installment)
      )),
      status=case when greatest(plan.latest_known_installment,coalesce((
        select max(occurrence.installment_number)
        from public.card_installment_occurrences occurrence
        where occurrence.installment_plan_id=canonical_id
          and occurrence.status in ('posted','confirmed','paid')
      ),plan.latest_known_installment))>=plan.total_installments
        then 'completed' else 'active' end
    where plan.id=canonical_id;
  end loop;

  update public.card_installment_plans plan set
    matching_fingerprint=concat_ws('|','atlas:installment:v2',plan.card_id,
      coalesce(plan.card_last_four,''),plan.merchant_normalized,
      (select min(entry.transaction_date)::text
       from public.invoice_entries entry
       where entry.linked_installment_plan_id=plan.id),
      plan.total_installments,plan.currency_code)
  where exists (
      select 1 from public.invoice_entries entry
      where entry.linked_installment_plan_id=plan.id
        and entry.transaction_date is not null
    )
    and plan.status<>'cancelled'
    and plan.matching_fingerprint not like 'atlas:manual-plan:%';
end
$repair$;

do $function_update$
declare
  previous_definition text;
  fixed_definition text;
begin
  select pg_get_functiondef(
    'public.confirm_invoice_pdf_import(uuid,jsonb)'::regprocedure
  ) into previous_definition;

  fixed_definition:=regexp_replace(
    previous_definition,
    'fingerprint\s*:=\s*encode\(extensions\.digest\(\s*concat_ws\(''\|'',doc\.workspace_id,doc\.card_id,coalesce\(entry->>''cardLastFour'',''''\),\s*entry->>''merchantNormalized'',installment_amount,total_n,coalesce\(entry->>''currencyCode'',''BRL''\)\),\s*''sha256''\),''hex''\);',
    'fingerprint:=concat_ws(''|'',''atlas:installment:v2'',doc.card_id,coalesce(entry->>''cardLastFour'',''''),entry->>''merchantNormalized'',coalesce(nullif(entry->>''transactionDate'',''''),(reference_month-(current_n-1)*interval ''1 month'')::date::text),total_n,coalesce(entry->>''currencyCode'',''BRL''));',
    'i'
  );

  if fixed_definition !~* 'installment_amount\s*=\s*excluded\.installment_amount' then
    fixed_definition:=regexp_replace(
      fixed_definition,
      '(on conflict\s*\(workspace_id,card_id,matching_fingerprint\)\s*do update set\s*)',
      '\1installment_amount=excluded.installment_amount, ',
      'i'
    );
  end if;
  if fixed_definition !~* 'on conflict\s*\(installment_plan_id,installment_number\)\s*do update set\s*amount\s*=\s*excluded\.amount' then
    fixed_definition:=regexp_replace(
      fixed_definition,
      '(on conflict\s*\(installment_plan_id,installment_number\)\s*do update set\s*)',
      '\1amount=excluded.amount, ',
      'i'
    );
  end if;
  if fixed_definition not like '%atlas:installment:v2%'
    or fixed_definition !~* 'installment_amount\s*=\s*excluded\.installment_amount'
    or fixed_definition !~* 'on conflict\s*\(installment_plan_id,installment_number\)\s*do update set\s*amount\s*=\s*excluded\.amount'
  then
    raise exception 'confirm_invoice_pdf_import_installment_identity_incomplete';
  end if;

  if fixed_definition<>previous_definition then execute fixed_definition; end if;
end
$function_update$;
