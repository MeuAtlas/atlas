-- Atlas Flight 3C.4: direitos econômicos auditáveis, isolados por import e sem composição de remuneração.
create table if not exists public.flight_financial_entitlements(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 subject_type text not null check(subject_type in ('DUTY','TRIP')),
 subject_id text not null,
 entitlement_type text not null check(entitlement_type in ('DOMESTIC_BREAKFAST','DOMESTIC_LUNCH','DOMESTIC_DINNER','DOMESTIC_SUPPER','INTERNATIONAL_BREAKFAST','INTERNATIONAL_LUNCH','INTERNATIONAL_DINNER','INTERNATIONAL_SUPPER','MADRUGADA_TRANSPORT_REIMBURSEMENT')),
 entitlement_date date not null,
 location text,
 country char(2),
 domesticity text check(domesticity is null or domesticity in ('DOMESTIC','INTERNATIONAL')),
 currency char(3),
 amount_minor_units bigint check(amount_minor_units is null or amount_minor_units >= 0),
 quantity integer not null default 1 check(quantity > 0),
 start_at timestamptz not null,
 end_at timestamptz not null,
 eligibility_status text not null check(eligibility_status in ('ELIGIBLE','NOT_ELIGIBLE','UNKNOWN')),
 reason text,
 source_instrument_id uuid references public.flight_legal_instruments(id) on delete restrict,
 source_clause text,
 profile_fact_source text,
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
 lifecycle text not null check(lifecycle in ('DRAFT','REVIEWED','ACTIVE','RETIRED','REVIEW_REQUIRED')),
 engine_version text not null,
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(end_at >= start_at),
 unique(import_id, entitlement_type, subject_id, entitlement_date, location)
);
create index if not exists flight_financial_entitlements_import_idx on public.flight_financial_entitlements(import_id,eligibility_status,entitlement_type);
do $$ begin create trigger flight_financial_entitlements_set_updated_at before update on public.flight_financial_entitlements for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
alter table public.flight_financial_entitlements enable row level security;
create policy flight_financial_entitlements_owner_read on public.flight_financial_entitlements for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.flight_schedule_imports schedule_import where schedule_import.id=import_id and schedule_import.user_id=auth.uid()));
grant select on public.flight_financial_entitlements to authenticated;
grant select,insert,update,delete on public.flight_financial_entitlements to service_role;

-- Confirmações pessoais são locais e temporais: RBR dispensa hotel, sem remover o direito ao café.
update public.flight_compensation_profile_policies p
set value='HOTEL_NORMALLY_USED_WITH_RBR_WAIVER', source_type='USER_CONFIRMED_PROFILE_FACT', source_reference='Perfil confirmado: RBR tem dispensa de hotel por opção do usuário; demais localidades não têm dispensa inferida.', confidence='HIGH', metadata='{"waivedLocations":["RBR"]}'::jsonb, updated_at=now()
from public.flight_compensation_profiles profile
where p.profile_id=profile.id and p.policy_key='HOTEL_USAGE_POLICY' and profile.contractual_base='BSB';
update public.flight_compensation_profile_policies p
set value='BREAKFAST_STILL_DUE_AT_RBR', source_type='USER_CONFIRMED_PROFILE_FACT', source_reference='Perfil confirmado: em RBR, a dispensa de hotel não elimina o direito ao café da manhã.', confidence='HIGH', metadata='{"stillDueLocations":["RBR"]}'::jsonb, updated_at=now()
from public.flight_compensation_profiles profile
where p.profile_id=profile.id and p.policy_key='BREAKFAST_POLICY' and profile.contractual_base='BSB';
update public.flight_economic_parameters set value_cents=2500, value_numeric=null, value_unit='CENT_PER_REIMBURSEMENT', lifecycle='REVIEWED', source_clause_reference='5.9', source_reference='ACT 5.9; valor documental vigente catalogado para transporte de madrugada.', metadata='{}'::jsonb, updated_at=now() where parameter_key='MADRUGADA_TRANSPORT' and role is null and effective_from='2025-10-01';
