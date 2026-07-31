-- Aplica os mesmos vínculos automáticos às compras de cartão compatíveis.

create or replace function public.apply_financial_entity_rules_for_card_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_rule public.financial_classification_rules%rowtype;
  target_workspace uuid;
  effective_date date;
  effective_amount numeric;
begin
  if new.status in ('cancelled','ignored') then
    return new;
  end if;

  target_workspace := new.workspace_id;
  if target_workspace is null then
    select workspace.id into target_workspace
    from public.workspaces workspace
    where workspace.owner_id = new.owner_id
      and workspace.type = 'personal'
      and workspace.archived_at is null
    order by workspace.created_at
    limit 1;
  end if;
  if target_workspace is null then return new; end if;

  effective_date := coalesce(new.competence_date, new.purchase_date);
  effective_amount := abs(coalesce(
    new.amount_brl,
    new.installment_amount,
    new.total_amount,
    0
  ));

  if exists (
    select 1
    from public.transaction_entities link
    where link.card_movement_id = new.id
      and link.is_primary
      and link.manually_confirmed
  ) then
    return new;
  end if;

  select rule.* into matched_rule
  from public.financial_classification_rules rule
  where rule.workspace_id = target_workspace
    and rule.is_active
    and rule.auto_apply
    and rule.archived_at is null
    and rule.entity_id is not null
    and rule.direction_scope in ('both','outgoing_only')
    and (rule.valid_from is null or rule.valid_from <= effective_date)
    and (rule.valid_until is null or rule.valid_until >= effective_date)
    and exists (
      select 1
      from public.financial_rule_conditions condition
      where condition.rule_id = rule.id
    )
    and not exists (
      select 1
      from public.financial_rule_conditions condition
      cross join lateral (
        select case condition.field_name
          when 'provider_counterparty_id' then
            new.provider_metadata #>> '{counterparty,providerCounterpartyId}'
          when 'pix_key_hash' then
            new.provider_metadata #>> '{counterparty,pixKeyHash}'
          when 'tax_number_hash' then
            new.provider_metadata #>> '{counterparty,taxNumberHash}'
          when 'normalized_counterparty_name' then lower(regexp_replace(
            translate(coalesce(
              new.provider_metadata #>> '{counterparty,normalizedName}',
              new.provider_metadata #>> '{counterparty,displayName}',
              new.merchant,
              new.description
            ), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
            '[^a-zA-Z0-9]+', ' ', 'g'
          ))
          when 'bank_name' then
            new.provider_metadata #>> '{counterparty,bankName}'
          when 'account_masked' then
            new.provider_metadata #>> '{counterparty,accountMasked}'
          when 'merchant_name' then new.merchant
          when 'description' then new.description
          when 'transaction_type' then new.transaction_role
          when 'provider_category' then new.provider_category
          when 'direction' then 'outflow'
          when 'card_id' then new.card_id::text
          when 'amount' then effective_amount::text
          else null
        end as actual_value
      ) value
      where condition.rule_id = rule.id
        and not (
          condition.operator = 'range'
            and (condition.numeric_min is null or effective_amount >= condition.numeric_min)
            and (condition.numeric_max is null or effective_amount <= condition.numeric_max)
          or condition.operator = 'hash_equals'
            and value.actual_value = condition.comparison_hash
          or condition.operator in ('equals','matches_normalized')
            and lower(value.actual_value) = lower(condition.comparison_value)
          or condition.operator = 'contains'
            and lower(value.actual_value) like '%' || lower(condition.comparison_value) || '%'
          or condition.operator = 'starts_with'
            and lower(value.actual_value) like lower(condition.comparison_value) || '%'
          or condition.operator = 'ends_with'
            and lower(value.actual_value) like '%' || lower(condition.comparison_value)
          or condition.operator = 'in'
            and lower(value.actual_value) = any(
              string_to_array(lower(condition.comparison_value), ',')
            )
        )
    )
  order by rule.priority, rule.created_at
  limit 1;

  if matched_rule.id is not null then
    insert into public.transaction_entities (
      workspace_id,
      card_movement_id,
      entity_id,
      rule_id,
      counterparty_id,
      group_id,
      category_id,
      assigned_nature,
      match_confidence,
      match_source,
      manually_confirmed,
      is_primary,
      linked_at
    ) values (
      target_workspace,
      new.id,
      matched_rule.entity_id,
      matched_rule.id,
      matched_rule.counterparty_id,
      matched_rule.group_id,
      matched_rule.category_id,
      matched_rule.resulting_nature,
      0.99,
      'movement_source_rule',
      false,
      true,
      now()
    )
    on conflict (card_movement_id, entity_id) do update set
      rule_id = excluded.rule_id,
      counterparty_id = coalesce(
        public.transaction_entities.counterparty_id,
        excluded.counterparty_id
      ),
      group_id = coalesce(
        public.transaction_entities.group_id,
        excluded.group_id
      ),
      category_id = coalesce(
        public.transaction_entities.category_id,
        excluded.category_id
      ),
      assigned_nature = coalesce(
        public.transaction_entities.assigned_nature,
        excluded.assigned_nature
      ),
      match_confidence = excluded.match_confidence,
      match_source = case
        when public.transaction_entities.manually_confirmed
          then public.transaction_entities.match_source
        else excluded.match_source
      end,
      updated_at = now();

    update public.financial_classification_rules
    set last_applied_at = now(), updated_at = now()
    where id = matched_rule.id;

    update public.financial_entity_counterparties
    set last_applied_at = now(), updated_at = now()
    where id = matched_rule.counterparty_id;
  end if;

  return new;
end $$;

drop trigger if exists card_purchases_apply_financial_entity_rules
  on public.card_purchases;
create trigger card_purchases_apply_financial_entity_rules
after insert or update of
  provider_metadata,
  merchant,
  description,
  amount_brl,
  installment_amount,
  competence_date,
  status
on public.card_purchases
for each row execute function
  public.apply_financial_entity_rules_for_card_purchase();
