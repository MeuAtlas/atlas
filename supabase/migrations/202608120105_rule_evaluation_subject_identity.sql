alter table public.flight_rule_evaluations
  drop constraint if exists flight_rule_evaluations_schedule_import_id_rule_key_rule_version_subject_type_subject_id_key;

-- Legacy rows are kept. Their own UUID is only a non-null transitional identity;
-- the Rules Engine replaces them deterministically per import on the next run.
update public.flight_rule_evaluations
set subject_id = id
where subject_id is null;

alter table public.flight_rule_evaluations
  alter column subject_id set not null;

alter table public.flight_rule_evaluations
  add constraint flight_rule_evaluations_unique_subject_evaluation
  unique(schedule_import_id, ruleset_version, rule_version, rule_key, evaluation_context, subject_type, subject_id);
