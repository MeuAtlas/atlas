-- Atlas Flight 3C.2: unidades remuneraveis auditaveis; nao calcula moeda nem compliance.
create table if not exists public.flight_financial_facts(
  id uuid primary key,
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  subject_type text not null check(subject_type in ('LEG','EVENT','IMPORT')),
  subject_id uuid,
  financial_fact_type text not null check(financial_fact_type in ('OPERATING_REMUNERABLE_MINUTES','DEADHEAD_REMUNERABLE_MINUTES','STANDBY_GUARANTEE_EQUIVALENT','RESERVE_REMUNERABLE_MINUTES','PRELIMINARY_GUARANTEE_ACCUMULATOR')),
  actual_seconds bigint not null check(actual_seconds>=0),
  remunerable_seconds bigint not null check(remunerable_seconds>=0),
  guarantee_numerator_seconds bigint not null check(guarantee_numerator_seconds>=0),
  guarantee_denominator smallint not null check(guarantee_denominator>0),
  normal_operating_candidate_seconds bigint not null check(normal_operating_candidate_seconds>=0),
  deadhead_candidate_seconds bigint not null check(deadhead_candidate_seconds>=0),
  standby_equivalent_numerator_seconds bigint not null check(standby_equivalent_numerator_seconds>=0),
  standby_equivalent_denominator smallint not null check(standby_equivalent_denominator>0),
  reserve_candidate_seconds bigint not null check(reserve_candidate_seconds>=0),
  special_time_pending_seconds bigint not null check(special_time_pending_seconds>=0),
  currency char(3) check(currency is null or currency='BRL'),
  source_type text not null check(source_type in ('DOCUMENT','CALCULATED','UNKNOWN')),
  confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
  lifecycle text not null check(lifecycle in ('DRAFT','REVIEWED','ACTIVE','RETIRED','REVIEW_REQUIRED')),
  engine_version text not null,
  provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
  attributes jsonb not null default '{}'::jsonb check(jsonb_typeof(attributes)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(import_id,financial_fact_type,subject_type,subject_id)
);
create index if not exists flight_financial_facts_import_type_idx on public.flight_financial_facts(import_id,financial_fact_type);
do $$ begin create trigger flight_financial_facts_set_updated_at before update on public.flight_financial_facts for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
alter table public.flight_financial_facts enable row level security;
create policy flight_financial_facts_owner_read on public.flight_financial_facts for select to authenticated using(exists(select 1 from public.flight_schedule_imports schedule_import where schedule_import.id=import_id and schedule_import.user_id=auth.uid()));
grant select on public.flight_financial_facts to authenticated;
grant select,insert,update,delete on public.flight_financial_facts to service_role;
