alter table public.card_purchases
  drop constraint if exists card_purchases_installment_confidence_check;

update public.card_purchases
set installment_confidence = case
  when installment_manually_confirmed or installment_source = 'manual' then 'manual'
  when is_installment and installment_source = 'provider_structured' then 'confirmed'
  when is_installment and installment_source = 'provider_description' then 'inferred'
  else 'unknown'
end;

alter table public.card_purchases
  alter column installment_confidence set default 'unknown',
  add constraint card_purchases_installment_confidence_check
    check (installment_confidence in ('confirmed','inferred','manual','unknown'));
