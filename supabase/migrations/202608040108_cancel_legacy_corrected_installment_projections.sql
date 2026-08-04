-- Legacy open-cycle backfills did not link their plans to invoice_entries.
-- Cancel only high-confidence duplicate projections: same structural plan,
-- same first competence and an amount correction no greater than R$ 1.00.
-- Posted history is preserved and no row is deleted.

do $repair$
declare
  duplicate_group record;
  canonical_id uuid;
  duplicate_plan record;
begin
  for duplicate_group in
    select
      workspace_id,owner_id,card_id,coalesce(card_last_four,'') card_last_four,
      merchant_normalized,total_installments,currency_code,
      estimated_first_competence
    from public.card_installment_plans
    where status<>'cancelled'
      and matching_fingerprint not like 'atlas:manual-plan:%'
    group by workspace_id,owner_id,card_id,coalesce(card_last_four,''),
      merchant_normalized,total_installments,currency_code,
      estimated_first_competence
    having count(*)>1
      and max(installment_amount)-min(installment_amount) between 0.01 and 1.00
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
      and plan.estimated_first_competence=duplicate_group.estimated_first_competence
      and plan.status<>'cancelled'
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
        and plan.estimated_first_competence=duplicate_group.estimated_first_competence
        and plan.status<>'cancelled'
        and plan.id<>canonical_id
    loop
      update public.card_installment_occurrences
      set status='cancelled'
      where installment_plan_id=duplicate_plan.id
        and status='projected';

      update public.card_installment_plans
      set status='cancelled',remaining_installments=0
      where id=duplicate_plan.id;
    end loop;
  end loop;
end
$repair$;
