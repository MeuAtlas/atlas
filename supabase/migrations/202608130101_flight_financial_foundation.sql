-- Atlas Flight 3C.1: catalogo financeiro versionado. Nenhum calculo mensal e criado aqui.
create table if not exists public.flight_compensation_profiles(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  effective_from date not null,
  effective_to date,
  airline text not null default 'GOL',
  aircraft_family text,
  role text not null check(role in ('COPILOT','COMMANDER')),
  role_effective_from date,
  seniority_percentage numeric(6,2) not null default 0 check(seniority_percentage >= 0),
  internal_commander_promotion_bonus_percentage numeric(6,2),
  contractual_base text,
  employment_regime text,
  source_type text not null check(source_type in ('DOCUMENT_SOURCE','USER_CONFIRMED_PROFILE_FACT','SYSTEM_DERIVED')),
  source_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(effective_to is null or effective_to >= effective_from),
  unique(user_id,effective_from)
);

create table if not exists public.flight_compensation_profile_policies(
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.flight_compensation_profiles(id) on delete cascade,
  policy_key text not null check(policy_key in ('DEADHEAD_REMUNERATION_POLICY','HOTEL_USAGE_POLICY','BREAKFAST_POLICY','MADRUGADA_TRANSPORT_POLICY')),
  value text not null,
  source_type text not null check(source_type in ('DOCUMENT_SOURCE','USER_CONFIRMED_PROFILE_FACT','SYSTEM_DERIVED')),
  source_reference text,
  confidence text not null default 'HIGH' check(confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id,policy_key)
);

create table if not exists public.flight_economic_parameters(
  id uuid primary key default gen_random_uuid(),
  parameter_key text not null check(parameter_key ~ '^[A-Z0-9][A-Z0-9._-]{1,119}$'),
  role text check(role is null or role in ('COPILOT','COMMANDER')),
  value_cents bigint check(value_cents is null or value_cents >= 0),
  value_numeric numeric(14,4),
  value_unit text not null,
  currency char(3) not null default 'BRL' check(currency='BRL'),
  effective_from date,
  effective_to date,
  lifecycle text not null check(lifecycle in ('DRAFT','REVIEWED','ACTIVE','RETIRED','REVIEW_REQUIRED')),
  source_type text not null check(source_type in ('DOCUMENT_SOURCE','USER_CONFIRMED_PROFILE_FACT','SYSTEM_DERIVED')),
  source_instrument_id uuid references public.flight_legal_instruments(id) on delete restrict,
  source_clause_reference text,
  source_reference text,
  confidence text not null default 'HIGH' check(confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
  derived boolean not null default false,
  seniority_applicable boolean not null default false,
  notes text,
  metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(effective_to is null or effective_from is null or effective_to >= effective_from),
  check(value_cents is not null or value_numeric is not null or metadata <> '{}'::jsonb),
  unique nulls not distinct(parameter_key,role,effective_from)
);

create index if not exists flight_compensation_profiles_user_period_idx on public.flight_compensation_profiles(user_id,effective_from desc);
create index if not exists flight_economic_parameters_lookup_idx on public.flight_economic_parameters(parameter_key,role,effective_from desc);

do $$ begin create trigger flight_compensation_profiles_set_updated_at before update on public.flight_compensation_profiles for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_compensation_profile_policies_set_updated_at before update on public.flight_compensation_profile_policies for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_economic_parameters_set_updated_at before update on public.flight_economic_parameters for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;

alter table public.flight_compensation_profiles enable row level security;
alter table public.flight_compensation_profile_policies enable row level security;
alter table public.flight_economic_parameters enable row level security;
create policy flight_compensation_profiles_owner_read on public.flight_compensation_profiles for select to authenticated using(user_id=auth.uid());
create policy flight_compensation_profile_policies_owner_read on public.flight_compensation_profile_policies for select to authenticated using(exists(select 1 from public.flight_compensation_profiles profile where profile.id=profile_id and profile.user_id=auth.uid()));
create policy flight_economic_parameters_authenticated_read on public.flight_economic_parameters for select to authenticated using(true);
grant select on public.flight_compensation_profiles,public.flight_compensation_profile_policies,public.flight_economic_parameters to authenticated;
grant select,insert,update,delete on public.flight_compensation_profiles,public.flight_compensation_profile_policies,public.flight_economic_parameters to service_role;

-- O primeiro periodo documentado ancora o perfil atual confirmado, sem afirmar historico anterior.
insert into public.flight_compensation_profiles(user_id,effective_from,role,role_effective_from,seniority_percentage,source_type,source_reference)
select distinct i.user_id, i.document_period_start, 'COPILOT', i.document_period_start, 7.00, 'USER_CONFIRMED_PROFILE_FACT', 'Perfil atual confirmado pelo usuario; vigencia ancorada ao primeiro periodo importado.'
from public.flight_schedule_imports i
where i.schedule_role='PLANNED' and i.document_period_start is not null
on conflict (user_id,effective_from) do nothing;

insert into public.flight_compensation_profile_policies(profile_id,policy_key,value,source_type,source_reference,confidence,metadata)
select profile.id,'DEADHEAD_REMUNERATION_POLICY','SAME_AS_OPERATING_FOR_REMUNERATION','USER_CONFIRMED_PROFILE_FACT','Confirmacao do usuario para remuneracao; separado de regras regulatorias de deadhead.','HIGH','{"separateFromRegulatoryDeadhead":true}'::jsonb
from public.flight_compensation_profiles profile
on conflict (profile_id,policy_key) do nothing;

insert into public.flight_compensation_profile_policies(profile_id,policy_key,value,source_type,confidence)
select profile.id, policy.policy_key, 'UNKNOWN', 'SYSTEM_DERIVED', 'UNKNOWN'
from public.flight_compensation_profiles profile cross join (values ('HOTEL_USAGE_POLICY'),('BREAKFAST_POLICY'),('MADRUGADA_TRANSPORT_POLICY')) as policy(policy_key)
on conflict (profile_id,policy_key) do nothing;

-- Valores monetarios permanecem em centavos; o aditivo ainda nao possui vigencia global confirmada.
with source_ids as (select 'a49d8597-8372-4682-9e3b-4f97d4b21944'::uuid act_id,'115bd54f-12ec-4e4f-85f6-2c42820a567d'::uuid cct_id,'42b1c3f5-978b-4170-84f1-75a090d896e1'::uuid addendum_id), parameters(parameter_key,role,value_cents,value_numeric,value_unit,effective_from,lifecycle,source_type,source_kind,source_clause_reference,derived,seniority_applicable,metadata) as (
 values
 ('FLIGHT_HOUR_BASE','COMMANDER',19451,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_DSR','COMMANDER',7073,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_HAZARD','COMMANDER',7957,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_TOTAL','COMMANDER',28181,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','SYSTEM_DERIVED','ADDENDUM',null,true,false,'{"components":["FLIGHT_HOUR_BASE","FLIGHT_HOUR_DSR","FLIGHT_HOUR_HAZARD"]}'::jsonb),
 ('FLIGHT_HOUR_BASE','COPILOT',8947,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_DSR','COPILOT',3253,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_HAZARD','COPILOT',3660,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{}'::jsonb),
 ('FLIGHT_HOUR_TOTAL','COPILOT',15860,null,'CENT_PER_FLIGHT_HOUR',null,'REVIEW_REQUIRED','SYSTEM_DERIVED','ADDENDUM',null,true,false,'{"components":["FLIGHT_HOUR_BASE","FLIGHT_HOUR_DSR","FLIGHT_HOUR_HAZARD"]}'::jsonb),
 ('SALARY_FLOOR','COMMANDER',null,null,'CENT_PER_MONTH',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ACT',null,false,true,'{"requiresSourceValue":true}'::jsonb),
 ('SALARY_FLOOR','COPILOT',null,null,'CENT_PER_MONTH',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ACT',null,false,true,'{"requiresSourceValue":true}'::jsonb),
 ('MONTHLY_FLIGHT_HOUR_GUARANTEE',null,null,3240,'MINUTES','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT',null,false,false,'{}'::jsonb),
 ('STANDBY_EQUIVALENCE',null,null,1,'RATIO','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT',null,false,false,'{"numerator":1,"denominator":3}'::jsonb),
 ('RESERVE_HOUR_RELATION',null,null,null,'REFERENCE','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT',null,false,false,'{"relation":"SAME_AS_NORMAL_FLIGHT_HOUR","referencedParameterKey":"FLIGHT_HOUR_TOTAL"}'::jsonb),
 ('SUNDAY_HOLIDAY_MULTIPLIER',null,null,2,'MULTIPLIER','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT','4.6',false,false,'{}'::jsonb),
 ('NIGHT_WINDOW',null,null,null,'UTC_TIME_WINDOW','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT',null,false,false,'{"start":"21:00","end":"09:00","timezone":"UTC"}'::jsonb),
 ('NIGHT_HOUR_DURATION',null,null,3150,'SECONDS','2025-10-01','REVIEWED','DOCUMENT_SOURCE','ACT',null,false,false,'{}'::jsonb),
 ('ECONOMIC_ADJUSTMENT',null,null,4.68,'PERCENT','2025-12-01','REVIEWED','DOCUMENT_SOURCE','CCT',null,false,false,'{"eligibleParameterFamilies":["SALARY_FLOOR","MEAL_MAIN_DIEM"],"automaticallyApplied":false}'::jsonb),
 ('FUTURE_ECONOMIC_ADJUSTMENT',null,null,10,'PERCENT','2027-04-01','REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"adjustmentOnly":true,"automaticallyApplied":false}'::jsonb),
 ('MEAL_MAIN_DIEM',null,10995,null,'CENT_PER_DIEM','2025-12-01','REVIEWED','DOCUMENT_SOURCE','CCT',null,false,false,'{}'::jsonb),
 ('BREAKFAST_DIEM_PERCENT',null,null,25,'PERCENT','2025-12-01','REVIEWED','DOCUMENT_SOURCE','CCT',null,false,false,'{"baseParameterKey":"MEAL_MAIN_DIEM"}'::jsonb),
 ('MADRUGADA_TRANSPORT',null,null,null,'POLICY','2025-10-01','REVIEW_REQUIRED','DOCUMENT_SOURCE','ACT',null,false,false,'{"requiresSourceValue":true}'::jsonb),
 ('SENIORITY_ANNUAL_RATE','COMMANDER',null,1.25,'PERCENT',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"appliesTo":"SALARY_FLOOR"}'::jsonb),
 ('SENIORITY_MAX_PERCENT','COMMANDER',null,20,'PERCENT',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"appliesTo":"SALARY_FLOOR"}'::jsonb),
 ('SENIORITY_ANNUAL_RATE','COPILOT',null,1,'PERCENT',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"appliesTo":"SALARY_FLOOR"}'::jsonb),
 ('SENIORITY_MAX_PERCENT','COPILOT',null,16,'PERCENT',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"appliesTo":"SALARY_FLOOR"}'::jsonb),
 ('INTERNAL_COMMANDER_PROMOTION_BONUS','COMMANDER',null,3,'PERCENT',null,'REVIEW_REQUIRED','DOCUMENT_SOURCE','ADDENDUM',null,false,false,'{"appliesTo":"SALARY_FLOOR"}'::jsonb)
)
insert into public.flight_economic_parameters(parameter_key,role,value_cents,value_numeric,value_unit,effective_from,lifecycle,source_type,source_instrument_id,source_clause_reference,source_reference,derived,seniority_applicable,metadata)
select p.parameter_key,p.role,p.value_cents,p.value_numeric,p.value_unit,p.effective_from::date,p.lifecycle,p.source_type,case p.source_kind when 'ACT' then s.act_id when 'CCT' then s.cct_id else s.addendum_id end,p.source_clause_reference,'Fonte documental catalogada na Etapa 3C.1; nenhum calculo mensal foi executado.',p.derived,p.seniority_applicable,p.metadata
from parameters p cross join source_ids s
on conflict (parameter_key,role,effective_from) do nothing;
