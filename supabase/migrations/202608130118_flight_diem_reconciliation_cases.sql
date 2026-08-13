-- Atlas Flight 3C: audit trail for rule-based daily diem reconciliation.
create table if not exists public.flight_diem_reconciliation_cases(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 entitlement_date date not null,
 meal_type text not null,
 atlas_status text not null check(atlas_status in ('ELIGIBLE','NOT_ELIGIBLE','UNKNOWN')),
 atlas_amount_minor_units bigint,
 atlas_currency char(3),
 atlas_reason text,
 external_reference_status text,
 external_reference_label text,
 expected_status text not null check(expected_status in ('ELIGIBLE','NOT_ELIGIBLE','UNKNOWN')),
 expected_amount_minor_units bigint,
 expected_currency char(3),
 difference_type text not null check(difference_type in ('MATCH','ATLAS_MISSING','ATLAS_EXTRA','ATLAS_WRONG_STATUS','ATLAS_WRONG_CURRENCY','ATLAS_WRONG_AMOUNT','EXTERNAL_REFERENCE_DISAGREES','REVIEW_REQUIRED')),
 root_cause text,
 resolution_status text not null check(resolution_status in ('RESOLVED','REVIEW_REQUIRED','EXTERNAL_REFERENCE_ONLY')),
 source_clause text,
 profile_policy_used text,
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW','UNKNOWN')),
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(import_id,entitlement_date,meal_type)
);
create index if not exists flight_diem_reconciliation_cases_import_idx on public.flight_diem_reconciliation_cases(import_id,entitlement_date);
alter table public.flight_diem_reconciliation_cases enable row level security;
create policy flight_diem_reconciliation_cases_owner_read on public.flight_diem_reconciliation_cases for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
grant select on public.flight_diem_reconciliation_cases to authenticated;
grant select,insert,update,delete on public.flight_diem_reconciliation_cases to service_role;
do $$ begin create trigger flight_diem_reconciliation_cases_set_updated_at before update on public.flight_diem_reconciliation_cases for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
