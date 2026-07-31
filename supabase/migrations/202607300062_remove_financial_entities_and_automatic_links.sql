begin;

-- O usuário optou por trabalhar apenas com vínculos manuais por movimentação.
drop trigger if exists financial_transactions_apply_entity_rules
  on public.financial_transactions;
drop trigger if exists card_purchases_apply_financial_entity_rules
  on public.card_purchases;
drop trigger if exists person_counterparties_validate_entity_scope
  on public.person_counterparties;

drop function if exists public.apply_financial_entity_rules_for_transaction()
  cascade;
drop function if exists public.apply_financial_entity_rules_for_card_purchase()
  cascade;
drop function if exists public.validate_person_counterparty_entity_scope()
  cascade;
drop function if exists public.validate_financial_entity_scope()
  cascade;

-- Remove associações de pessoa que foram criadas por regra ou sugestão.
delete from public.transaction_people
where source in ('rule', 'suggestion')
   or (association_scope = 'similar' and not manually_confirmed);

-- Preserva vínculos manuais, mas normaliza todos para o lançamento atual.
update public.transaction_people
set association_scope = 'current',
    source = 'manual',
    manually_confirmed = true,
    match_confidence = 1,
    updated_at = now()
where manually_confirmed;

update public.financial_transactions transaction
set person_flow_role = null,
    updated_at = now()
where person_flow_role in ('sent_to_person', 'received_from_person')
  and not exists (
    select 1
    from public.transaction_people link
    where link.transaction_id = transaction.id
  );

-- Remove identificadores e sugestões usados exclusivamente para automação.
delete from public.person_transaction_match_suggestions;
delete from public.person_counterparties;

-- Desativa o reconhecimento automático dos compromissos existentes.
update public.financial_commitments
set auto_match_enabled = false,
    updated_at = now()
where auto_match_enabled;

delete from public.commitment_match_decisions;
delete from public.commitment_match_rules;

alter table public.person_counterparties
  drop column if exists financial_entity_id;

-- As movimentações bancárias e compras permanecem intactas. Somente o domínio
-- derivado de entidades, regras e vínculos é removido.
drop table if exists public.financial_entity_suggestions cascade;
drop table if exists public.transaction_entities cascade;
drop table if exists public.financial_rule_conditions cascade;
drop table if exists public.financial_classification_rules cascade;
drop table if exists public.financial_entity_counterparties cascade;
drop table if exists public.financial_entities cascade;

commit;
