-- Recria vínculos baseados em documento feitos antes de a prioridade do
-- fingerprint fiscal ser corrigida. A entidade é preservada; somente o
-- identificador automático, sua regra e os links derivados são invalidados.

do $$
declare
  affected_counterparties uuid[];
begin
  select coalesce(array_agg(distinct counterparty.id), '{}'::uuid[])
    into affected_counterparties
  from public.financial_entity_counterparties counterparty
  where counterparty.tax_number_hash is not null
    and counterparty.archived_at is null
    and exists (
      select 1
      from public.financial_classification_rules rule
      where rule.counterparty_id = counterparty.id
        and rule.rule_source = 'movement_link'
    );

  if cardinality(affected_counterparties) = 0 then
    return;
  end if;

  delete from public.transaction_entities link
  where link.counterparty_id = any(affected_counterparties)
    and link.match_source in (
      'manual_movement_link',
      'historical_backfill',
      'movement_source_rule'
    );

  update public.financial_classification_rules rule
  set is_active = false,
      archived_at = coalesce(rule.archived_at, now()),
      updated_at = now()
  where rule.counterparty_id = any(affected_counterparties)
    and rule.rule_source = 'movement_link';

  update public.financial_entity_counterparties counterparty
  set is_active = false,
      archived_at = coalesce(counterparty.archived_at, now()),
      updated_at = now()
  where counterparty.id = any(affected_counterparties);
end $$;
