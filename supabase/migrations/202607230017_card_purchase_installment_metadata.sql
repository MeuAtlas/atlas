alter table public.card_purchases
  alter column installment_number drop not null,
  alter column installment_number drop default,
  alter column installment_count drop not null,
  alter column installment_count drop default,
  add column if not exists total_purchase_amount numeric(15,2)
    check (total_purchase_amount is null or total_purchase_amount > 0),
  add column if not exists is_installment boolean not null default false,
  add column if not exists installment_source text not null default 'unknown'
    check (installment_source in ('provider_structured','provider_description','manual','unknown')),
  add column if not exists installment_confidence text not null default 'pending_review'
    check (installment_confidence in ('confirmed','inferred','pending_review')),
  add column if not exists installment_plan_id uuid
    references public.installment_plans(id) on delete set null,
  add column if not exists installment_manually_confirmed boolean not null default false;

update public.card_purchases
set
  total_purchase_amount = coalesce(total_purchase_amount,total_amount),
  is_installment = installment_count > 1,
  installment_source = case
    when installment_count > 1 and source = 'pluggy' then 'provider_structured'
    when installment_count > 1 then 'manual'
    else 'unknown'
  end,
  installment_confidence = case
    when installment_count > 1 then 'confirmed'
    else 'pending_review'
  end,
  installment_number = case when installment_count > 1 then installment_number else null end,
  installment_count = case when installment_count > 1 then installment_count else null end
where total_purchase_amount is null;

alter table public.card_purchases
  drop constraint if exists card_purchases_installment_number_check,
  drop constraint if exists card_purchases_installment_count_check;

alter table public.card_purchases
  add constraint card_purchases_installment_number_check
    check (installment_number is null or installment_number > 0),
  add constraint card_purchases_installment_count_check
    check (installment_count is null or installment_count > 1),
  add constraint card_purchases_installment_consistency_check
    check (
      (is_installment and installment_number is not null and installment_count is not null
        and installment_number <= installment_count)
      or
      (not is_installment and installment_number is null and installment_count is null)
    );

create index if not exists card_purchases_owner_installments
  on public.card_purchases(owner_id,is_installment,installment_count,installment_number);
