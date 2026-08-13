-- Atlas Flight Facts Engine v1: camada factual derivada, sem regras jurídicas.
create table public.flight_fact_runs(
 id uuid primary key default gen_random_uuid(), import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 engine_version text not null check(engine_version='flight-facts/1.0.0'), parser_version text, summary jsonb not null default '{}'::jsonb check(jsonb_typeof(summary)='object'), calculated_at timestamptz not null default now(), unique(import_id,engine_version)
);
create table public.flight_fact_records(
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.flight_fact_runs(id) on delete cascade, import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 fact_key text not null, subject_type text not null check(subject_type in('IMPORT','DAY','EVENT','DUTY','LEG','WINDOW','REST','OFF_PERIOD','GROUND_INTERVAL','SCHEDULE_CHANGE','PROFILE','OPERATOR')),
 subject_id uuid, value jsonb not null check(jsonb_typeof(value) in('object','array','string','number','boolean','null')), source_type text not null check(source_type in('DOCUMENT','CALCULATED','USER_CONFIRMED','EXTERNAL_SYSTEM','UNKNOWN')),
 confidence text not null check(confidence in('HIGH','MEDIUM','LOW')), schedule_state text not null check(schedule_state in('PLANNED','EXECUTION_SNAPSHOT','FINAL_EXECUTED')), fact_engine_version text not null check(fact_engine_version='flight-facts/1.0.0'), provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'), calculated_at timestamptz not null default now(),
 unique(run_id,fact_key,subject_type,subject_id)
);
create table public.flight_external_facts(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, import_id uuid references public.flight_schedule_imports(id) on delete cascade, fact_key text not null, value jsonb not null, source_type text not null check(source_type in('USER','COMPANY_DOCUMENT','EMAIL','APP_NOTIFICATION','MANUAL_ENTRY','OTHER')), confirmed_at timestamptz, evidence_reference text, effective_from timestamptz, effective_to timestamptz, created_at timestamptz not null default now(), check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
create table public.flight_legal_profile_facts(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, company text, role text, document_contractual_base text, profile_contractual_base text, aircraft_family text, virtual_base text, virtual_base_active text not null default 'UNKNOWN' check(virtual_base_active in('ACTIVE','INACTIVE','UNKNOWN')), employment_regime text not null default 'UNKNOWN', standby_regime text not null default 'UNKNOWN', sdu_group_active text not null default 'UNKNOWN' check(sdu_group_active in('ACTIVE','INACTIVE','UNKNOWN')), training_role text not null default 'UNKNOWN', online_training_program_active text not null default 'UNKNOWN' check(online_training_program_active in('ACTIVE','INACTIVE','UNKNOWN')), post_maternity_protection_active text not null default 'UNKNOWN' check(post_maternity_protection_active in('ACTIVE','INACTIVE','UNKNOWN')), source_type text not null default 'UNKNOWN' check(source_type in('DOCUMENT','CALCULATED','USER_CONFIRMED','EXTERNAL_SYSTEM','UNKNOWN')), confidence text not null default 'HIGH' check(confidence in('HIGH','MEDIUM','LOW')), effective_from date, effective_to date, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
create table public.flight_operator_facts(
 id uuid primary key default gen_random_uuid(), operator_name text not null, fact_key text not null, value jsonb not null, effective_from date, effective_to date, source_reference text, confidence text not null check(confidence in('HIGH','MEDIUM','LOW')), created_at timestamptz not null default now(), check(effective_to is null or effective_from is null or effective_to>=effective_from), unique(operator_name,fact_key,effective_from)
);
create index flight_fact_records_import_key_idx on public.flight_fact_records(import_id,fact_key); create index flight_fact_records_run_subject_idx on public.flight_fact_records(run_id,subject_type); create index flight_external_facts_import_idx on public.flight_external_facts(import_id,fact_key);
alter table public.flight_fact_runs enable row level security; alter table public.flight_fact_records enable row level security; alter table public.flight_external_facts enable row level security; alter table public.flight_legal_profile_facts enable row level security; alter table public.flight_operator_facts enable row level security;
create policy flight_fact_runs_owner_read on public.flight_fact_runs for select to authenticated using(exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_fact_records_owner_read on public.flight_fact_records for select to authenticated using(exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_external_facts_owner_read on public.flight_external_facts for select to authenticated using(user_id=auth.uid());
create policy flight_profile_facts_owner_read on public.flight_legal_profile_facts for select to authenticated using(user_id=auth.uid());
create policy flight_operator_facts_authenticated_read on public.flight_operator_facts for select to authenticated using(true);
grant select on public.flight_fact_runs,public.flight_fact_records,public.flight_external_facts,public.flight_legal_profile_facts,public.flight_operator_facts to authenticated;
grant select,insert,update,delete on public.flight_fact_runs,public.flight_fact_records to service_role;
