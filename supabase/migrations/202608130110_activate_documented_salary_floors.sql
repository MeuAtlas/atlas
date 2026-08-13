-- 3C.6A: pisos derivados apenas quando o ACT, o reajuste CCT e a vigência estão documentados.
-- Os componentes do aditivo de hora continuam REVIEW_REQUIRED: o instrumento não possui vigência.
with sources as (
  select
    'a49d8597-8372-4682-9e3b-4f97d4b21944'::uuid as act_id,
    '115bd54f-12ec-4e4f-85f6-2c42820a567d'::uuid as cct_id
), floors(role, act_value_cents) as (
  values ('COMMANDER'::text, 1381316::bigint), ('COPILOT'::text, 862239::bigint)
)
insert into public.flight_economic_parameters(
  parameter_key, role, value_cents, value_unit, currency, effective_from, lifecycle,
  source_type, source_instrument_id, source_clause_reference, source_reference,
  derived, seniority_applicable, confidence, metadata
)
select
  'SALARY_FLOOR', floors.role,
  round(floors.act_value_cents * 1.0468)::bigint,
  'CENT_PER_MONTH', 'BRL', '2025-12-01', 'ACTIVE',
  'SYSTEM_DERIVED', sources.act_id, 'ACT piso + CCT reajuste econômico 4,68%',
  'Piso ACT reajustado pelo CCT 2025/2026 com vigência documentada.',
  true, true, 'HIGH',
  jsonb_build_object(
    'sourceValueCents', floors.act_value_cents,
    'adjustmentPercent', 4.68,
    'adjustmentParameterKey', 'ECONOMIC_ADJUSTMENT',
    'adjustmentInstrumentId', sources.cct_id,
    'adjustmentEffectiveFrom', '2025-12-01',
    'sourceLinkage', 'ACT_PLUS_CCT_DOCUMENTED'
  )
from floors cross join sources
on conflict (parameter_key, role, effective_from) do update set
  value_cents = excluded.value_cents,
  lifecycle = excluded.lifecycle,
  source_instrument_id = excluded.source_instrument_id,
  source_clause_reference = excluded.source_clause_reference,
  source_reference = excluded.source_reference,
  derived = excluded.derived,
  seniority_applicable = excluded.seniority_applicable,
  confidence = excluded.confidence,
  metadata = excluded.metadata,
  updated_at = now();
