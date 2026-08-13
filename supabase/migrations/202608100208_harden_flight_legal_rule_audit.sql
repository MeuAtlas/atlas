-- Proteções e auditoria complementar da fundação jurídica da Etapa 3A.

create or replace function public.prevent_flight_active_rule_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.status='ACTIVE' and (
    new.rule_key,new.rule_version,new.title,new.description,new.rule_category,new.effective_from,new.effective_to,new.priority,new.scope,new.conditions,new.calculation,new.source_confidence,new.review_status,new.metadata
  ) is distinct from (
    old.rule_key,old.rule_version,old.title,old.description,old.rule_category,old.effective_from,old.effective_to,old.priority,old.scope,old.conditions,old.calculation,old.source_confidence,old.review_status,old.metadata
  ) then
    raise exception 'Regra ACTIVE não pode ser editada; crie uma nova versão.' using errcode='23514';
  end if;
  return new;
end $$;

create or replace function public.prevent_flight_legal_instrument_deletion()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'Instrumentos jurídicos são históricos e não podem ser apagados.' using errcode='23514';
end $$;

create or replace function public.audit_flight_legal_change()
returns trigger language plpgsql set search_path='' as $$
declare
  audit_event text;
  audit_entity_id uuid;
begin
  audit_entity_id := new.id;
  if tg_op='INSERT' then
    audit_event := case tg_table_name when 'flight_legal_instruments' then 'LEGAL_INSTRUMENT_CREATED' when 'flight_legal_clauses' then 'CLAUSE_CREATED' when 'flight_rules' then 'RULE_CREATED' when 'flight_rule_sets' then 'RULESET_CREATED' else null end;
  elsif tg_table_name='flight_legal_instruments' then
    audit_event := case when new.status='REVIEWED' and old.status is distinct from new.status then 'LEGAL_INSTRUMENT_REVIEWED' when new.status='ACTIVE' and old.status is distinct from new.status then 'LEGAL_INSTRUMENT_ACTIVATED' when new.status='SUPERSEDED' and old.status is distinct from new.status then 'LEGAL_INSTRUMENT_SUPERSEDED' else null end;
  elsif tg_table_name='flight_legal_clauses' then
    audit_event := 'CLAUSE_UPDATED';
  elsif tg_table_name='flight_rules' then
    audit_event := case when new.status='REVIEWED' and old.status is distinct from new.status then 'RULE_REVIEWED' when new.status='ACTIVE' and old.status is distinct from new.status then 'RULE_ACTIVATED' when new.status='SUPERSEDED' and old.status is distinct from new.status then 'RULE_SUPERSEDED' else null end;
  elsif tg_table_name='flight_rule_sets' then
    audit_event := case when new.status='ACTIVE' and old.status is distinct from new.status then 'RULESET_ACTIVATED' else null end;
  end if;
  if audit_event is not null then
    insert into public.flight_rule_audit_logs(actor_user_id,event_type,entity_type,entity_id,before_data,after_data)
    values(auth.uid(),audit_event,tg_table_name,audit_entity_id,case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
  end if;
  return new;
end $$;

do $$ begin create trigger flight_legal_instruments_prevent_delete before delete on public.flight_legal_instruments for each row execute function public.prevent_flight_legal_instrument_deletion(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_legal_instruments_audit after insert or update on public.flight_legal_instruments for each row execute function public.audit_flight_legal_change(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_legal_clauses_audit after insert or update on public.flight_legal_clauses for each row execute function public.audit_flight_legal_change(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rules_audit after insert or update on public.flight_rules for each row execute function public.audit_flight_legal_change(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_rule_sets_audit after insert or update on public.flight_rule_sets for each row execute function public.audit_flight_legal_change(); exception when duplicate_object then null; end $$;
