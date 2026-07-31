-- Vínculo simples por origem/destino real da movimentação.
-- Mantém identificadores sensíveis apenas como hashes server-side ou máscaras.

alter table public.financial_entity_counterparties
  add column if not exists description_fingerprint text,
  add column if not exists composite_fingerprint text,
  add column if not exists confidence numeric(5,4)
    check (confidence is null or confidence between 0 and 1),
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists source_fields jsonb not null default '[]'::jsonb,
  add column if not exists last_applied_at timestamptz;

alter table public.financial_classification_rules
  add column if not exists counterparty_id uuid
    references public.financial_entity_counterparties(id) on delete set null,
  add column if not exists rule_source text not null default 'manual'
    check (rule_source in ('manual','movement_link','system','migration')),
  add column if not exists last_applied_at timestamptz;

alter table public.transaction_entities
  add column if not exists counterparty_id uuid
    references public.financial_entity_counterparties(id) on delete set null,
  add column if not exists linked_at timestamptz not null default now();

alter table public.transaction_entities
  drop constraint if exists transaction_entities_match_source_check;
alter table public.transaction_entities
  add constraint transaction_entities_match_source_check check (match_source in (
    'manual','manual_movement_link','automatic_rule','movement_source_rule',
    'counterparty_match','suggestion','historical_backfill','system'
  ));

create index if not exists financial_entity_counterparties_workspace_idx
  on public.financial_entity_counterparties(workspace_id);
create index if not exists financial_entity_counterparties_composite_idx
  on public.financial_entity_counterparties(
    workspace_id, composite_fingerprint, direction_scope
  ) where composite_fingerprint is not null and is_active and archived_at is null;
create unique index if not exists financial_entity_counterparties_active_source_uidx
  on public.financial_entity_counterparties(
    workspace_id, composite_fingerprint, direction_scope
  ) where composite_fingerprint is not null and is_active and archived_at is null;
create index if not exists financial_entity_counterparties_active_lookup_idx
  on public.financial_entity_counterparties(
    workspace_id, is_active, direction_scope, valid_from, valid_until
  ) where archived_at is null;

create index if not exists financial_classification_rules_counterparty_idx
  on public.financial_classification_rules(
    workspace_id, counterparty_id, direction_scope, is_active
  ) where counterparty_id is not null and archived_at is null;
create index if not exists transaction_entities_rule_idx
  on public.transaction_entities(workspace_id, rule_id)
  where rule_id is not null;
create index if not exists transaction_entities_counterparty_idx
  on public.transaction_entities(workspace_id, counterparty_id)
  where counterparty_id is not null;
create index if not exists financial_transactions_owner_effective_idx
  on public.financial_transactions(owner_id, competence_date, bank_direction)
  where status in ('realized','pending');

create or replace function public.apply_financial_entity_rules_for_transaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  matched_rule public.financial_classification_rules%rowtype;
  target_workspace uuid;
begin
  target_workspace := new.workspace_id;
  if target_workspace is null then
    select workspace.id into target_workspace
    from public.workspaces workspace
    where workspace.owner_id = new.owner_id
      and workspace.type = 'personal'
    order by workspace.created_at
    limit 1;
  end if;

  if target_workspace is null
    or new.bank_direction not in ('inflow','outflow')
    or coalesce(new.manually_confirmed, false)
    or new.manual_override_at is not null
    or exists (
      select 1 from public.transaction_entities link
      where link.transaction_id = new.id and link.is_primary
        and link.manually_confirmed
    )
  then return new; end if;

  select rule.* into matched_rule
  from public.financial_classification_rules rule
  where rule.workspace_id = target_workspace
    and rule.is_active and rule.auto_apply and rule.archived_at is null
    and rule.entity_id is not null
    and (rule.valid_from is null or rule.valid_from <= new.competence_date)
    and (rule.valid_until is null or rule.valid_until >= new.competence_date)
    and (
      rule.direction_scope = 'both'
      or rule.direction_scope = 'incoming_only' and new.bank_direction = 'inflow'
      or rule.direction_scope = 'outgoing_only' and new.bank_direction = 'outflow'
    )
    and exists (
      select 1 from public.financial_rule_conditions condition
      where condition.rule_id = rule.id
    )
    and not exists (
      select 1
      from public.financial_rule_conditions condition
      cross join lateral (
        select case condition.field_name
          when 'provider_counterparty_id' then
            new.provider_metadata #>> '{counterparty,providerCounterpartyId}'
          when 'pix_key_hash' then new.provider_metadata #>> '{counterparty,pixKeyHash}'
          when 'tax_number_hash' then new.provider_metadata #>> '{counterparty,taxNumberHash}'
          when 'normalized_counterparty_name' then lower(regexp_replace(
            translate(coalesce(
              new.provider_metadata #>> '{counterparty,normalizedName}',
              new.provider_metadata #>> '{counterparty,displayName}',
              new.merchant, new.description
            ), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
            '[^a-zA-Z0-9]+', ' ', 'g'
          ))
          when 'bank_name' then new.provider_metadata #>> '{counterparty,bankName}'
          when 'account_masked' then new.provider_metadata #>> '{counterparty,accountMasked}'
          when 'merchant_name' then new.merchant
          when 'description' then new.description
          when 'transaction_type' then new.transaction_type
          when 'provider_category' then new.provider_category
          when 'direction' then new.bank_direction
          when 'account_id' then new.account_id::text
          when 'card_id' then new.credit_card_id::text
          when 'amount' then new.amount::text
          else null
        end as actual_value
      ) value
      where condition.rule_id = rule.id
        and not (
          condition.operator = 'range' and
            (condition.numeric_min is null or new.amount >= condition.numeric_min) and
            (condition.numeric_max is null or new.amount <= condition.numeric_max)
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
      workspace_id, transaction_id, entity_id, rule_id, counterparty_id,
      group_id, category_id, assigned_nature, match_confidence, match_source,
      manually_confirmed, is_primary, linked_at
    ) values (
      target_workspace, new.id, matched_rule.entity_id, matched_rule.id,
      matched_rule.counterparty_id, matched_rule.group_id, matched_rule.category_id,
      matched_rule.resulting_nature, 0.99, 'movement_source_rule',
      false, true, now()
    )
    on conflict (transaction_id, entity_id) do update set
      rule_id = excluded.rule_id,
      counterparty_id = coalesce(
        public.transaction_entities.counterparty_id, excluded.counterparty_id
      ),
      group_id = coalesce(public.transaction_entities.group_id, excluded.group_id),
      category_id = coalesce(
        public.transaction_entities.category_id, excluded.category_id
      ),
      assigned_nature = coalesce(
        public.transaction_entities.assigned_nature, excluded.assigned_nature
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

drop trigger if exists financial_transactions_apply_entity_rules
  on public.financial_transactions;
create trigger financial_transactions_apply_entity_rules
after insert or update of provider_metadata, bank_direction, competence_date,
  merchant, description, status
on public.financial_transactions
for each row execute function public.apply_financial_entity_rules_for_transaction();
