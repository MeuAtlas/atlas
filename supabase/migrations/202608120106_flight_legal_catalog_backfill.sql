-- Auditoria 3B: fontes já usadas pelo motor passam a ter catálogo e vínculo persistidos.
update public.flight_legal_instruments
set effective_from = date '2025-10-01', effective_to = date '2026-09-30', status = 'REVIEWED', updated_at = now()
where id = 'a49d8597-8372-4682-9e3b-4f97d4b21944';

update public.flight_legal_instruments
set effective_from = date '2025-12-01', effective_to = date '2026-11-30', status = 'REVIEWED', updated_at = now()
where id = '115bd54f-12ec-4e4f-85f6-2c42820a567d';

update public.flight_legal_instruments
set effective_from = null, effective_to = null, status = 'DRAFT', updated_at = now()
where id = '42b1c3f5-978b-4170-84f1-75a090d896e1';

insert into public.flight_legal_instruments(instrument_type,instrument_code,title,effective_from,effective_to,status,source_notes,metadata)
values
  ('LAW','LAW_13475_2017','Lei 13.475/2017',null,null,'DRAFT','Referência legal já codificada no Rules Engine; vigência documental não foi inferida nesta migration.','{"sourceCoverage":"REVIEW_REQUIRED","legalInterpretation":"NOT_PERFORMED"}'::jsonb),
  ('REGULATION','RBAC_117_EMD_01','RBAC 117 EMD 01',null,null,'DRAFT','Referência regulatória já codificada no Rules Engine; vigência documental não foi inferida nesta migration.','{"sourceCoverage":"REVIEW_REQUIRED","legalInterpretation":"NOT_PERFORMED"}'::jsonb)
on conflict (instrument_code,version) do update set title=excluded.title,source_notes=excluded.source_notes,metadata=excluded.metadata;

alter table public.flight_rules alter column effective_from drop not null;
alter table public.flight_rules drop constraint if exists flight_rules_effective_to_check;
alter table public.flight_rules add constraint flight_rules_effective_period_check check(
  (effective_from is not null and (effective_to is null or effective_to >= effective_from))
  or (status in ('DRAFT','REVIEWED') and effective_from is null and effective_to is null)
);

with act_clauses as (
  select distinct source->>'clause' as clause_number
  from public.flight_rule_evaluations evaluation
  cross join lateral jsonb_array_elements(evaluation.source_references) source
  where source->>'instrumentId' = 'a49d8597-8372-4682-9e3b-4f97d4b21944'
    and nullif(source->>'clause','') is not null
)
insert into public.flight_legal_clauses(instrument_id,clause_number,clause_key,title,source_text,status,metadata)
select 'a49d8597-8372-4682-9e3b-4f97d4b21944', clause_number, 'ACT_' || regexp_replace(clause_number,'[^A-Za-z0-9]+','_','g'), 'Referência ' || clause_number, 'Referência documental vinculada ao PDF oficial privado; texto normativo não foi reescrito nesta migration.', 'DRAFT', '{"referenceOnly":true,"reviewStatus":"REVIEW_REQUIRED"}'::jsonb
from act_clauses
on conflict (instrument_id,clause_key) do nothing;

with rule_inventory as (
  select distinct rule_key
  from public.flight_rule_evaluations
), rule_catalog as (
  select rule_key,
    case when rule_key like 'GOL_%' then 'ACTIVE' else 'REVIEWED' end as status,
    case when rule_key like 'GOL_%' and rule_key in ('GOL_SINGLE_OFF_ROLLING_30D_LIMIT','GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION','GOL_CGH_GRU_ADDITIONAL_REST') then date '2026-03-01'
         when rule_key like 'GOL_%' then date '2025-10-01' else null end as effective_from,
    case when rule_key like 'GOL_%' and rule_key in ('GOL_SINGLE_OFF_ROLLING_30D_LIMIT','GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION','GOL_CGH_GRU_ADDITIONAL_REST') then date '2026-09-30'
         when rule_key like 'GOL_%' then date '2026-09-30' else null end as effective_to,
    case when rule_key like 'RBAC117_%' then 'RBAC' when rule_key like 'LAW_%' then 'LAW' else 'ACT' end as source_kind
  from rule_inventory
)
insert into public.flight_rules(rule_key,rule_version,title,description,rule_category,effective_from,effective_to,status,priority,scope,conditions,calculation,source_confidence,review_status,metadata)
select rule_key,1,replace(rule_key,'_',' '),'Implementação técnica auditada na Etapa 3B.','OTHER',effective_from,effective_to,status::text,0,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,case when source_kind='ACT' then 'HIGH' else 'MEDIUM' end,case when status='ACTIVE' then 'APPROVED' else 'REVIEWED' end,jsonb_build_object('lifecycle',case when status='ACTIVE' then 'ACTIVE_COMPUTABLE' else 'REVIEW_REQUIRED' end,'sourceKind',source_kind,'actCctPriority',case when source_kind='ACT' then 'ACT_PRIMARY_CCT_SUPPORTING' else null end)
from rule_catalog
on conflict (rule_key,rule_version) do update set status=excluded.status,effective_from=excluded.effective_from,effective_to=excluded.effective_to,source_confidence=excluded.source_confidence,review_status=excluded.review_status,metadata=excluded.metadata;

insert into public.flight_rule_sources(rule_id,instrument_id,clause_id,source_role,notes)
select rule.id,act.id,clause.id,'PRIMARY','ACT é a fonte primária para regra operacional própria da GOL.'
from public.flight_rules rule
join public.flight_legal_instruments act on act.id='a49d8597-8372-4682-9e3b-4f97d4b21944'
join lateral (
  select source->>'clause' as clause_number
  from public.flight_rule_evaluations evaluation cross join lateral jsonb_array_elements(evaluation.source_references) source
  where evaluation.rule_key=rule.rule_key and source->>'instrumentId'=act.id::text and nullif(source->>'clause','') is not null
  limit 1
) reference on true
join public.flight_legal_clauses clause on clause.instrument_id=act.id and clause.clause_number=reference.clause_number
where rule.rule_key like 'GOL_%'
on conflict (rule_id,instrument_id,clause_id,source_role) do nothing;

insert into public.flight_rule_sources(rule_id,instrument_id,clause_id,source_role,notes)
select rule.id,cct.id,null,'SUPPLEMENTARY','CCT é fonte de apoio/referência para a GOL; regras financeiras permanecem fora do escopo da Etapa 3B.'
from public.flight_rules rule cross join public.flight_legal_instruments cct
where rule.rule_key like 'GOL_%' and cct.id='115bd54f-12ec-4e4f-85f6-2c42820a567d'
on conflict (rule_id,instrument_id,clause_id,source_role) do nothing;

insert into public.flight_rule_sources(rule_id,instrument_id,clause_id,source_role,notes)
select rule.id,instrument.id,null,'PRIMARY','Vínculo técnico persistido; confirmação documental de vigência permanece REVIEW_REQUIRED.'
from public.flight_rules rule
join public.flight_legal_instruments instrument on instrument.instrument_code=case when rule.rule_key like 'LAW_%' then 'LAW_13475_2017' else 'RBAC_117_EMD_01' end
where rule.rule_key like 'LAW_%' or rule.rule_key like 'RBAC117_%'
on conflict (rule_id,instrument_id,clause_id,source_role) do nothing;

insert into public.flight_rule_sets(ruleset_code,name,description,effective_from,effective_to,status,version,company_code,employee_category,metadata)
values ('GOL_OPERATIONAL_RULESET_2026_1','Ruleset operacional GOL 2026.1','Ruleset técnico auditável da Etapa 3B.',date '2025-10-01',date '2026-09-30','ACTIVE',1,'GOL','PILOT','{"actCctPriority":"ACT_PRIMARY_CCT_SUPPORTING","financialScope":"EXCLUDED"}'::jsonb)
on conflict (ruleset_code,version) do update set status=excluded.status,effective_from=excluded.effective_from,effective_to=excluded.effective_to,metadata=excluded.metadata;

insert into public.flight_rule_set_rules(ruleset_id,rule_id,sequence,enabled,metadata)
select ruleset.id,rule.id,row_number() over(order by rule.rule_key),true,'{}'::jsonb
from public.flight_rule_sets ruleset join public.flight_rules rule on rule.status='ACTIVE'
where ruleset.ruleset_code='GOL_OPERATIONAL_RULESET_2026_1' and ruleset.version=1
on conflict (ruleset_id,rule_id) do update set enabled=true;

grant select on public.flight_legal_clauses,public.flight_rules,public.flight_rule_sources,public.flight_rule_sets,public.flight_rule_set_rules to service_role;
