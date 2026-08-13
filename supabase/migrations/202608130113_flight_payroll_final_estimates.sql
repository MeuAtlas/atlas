create table if not exists public.flight_payroll_final_estimates(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null unique references public.flight_schedule_imports(id) on delete cascade,
 guarantee_target_seconds bigint not null,
 guarantee_eligible_total_seconds bigint not null,
 guarantee_consumed_seconds bigint not null,
 normal_within_guarantee_seconds bigint not null,
 normal_above_guarantee_seconds bigint not null,
 total_payroll_reference_seconds bigint not null,
 gross_amount_minor_units bigint not null,
 estimate_status text not null check(estimate_status in ('COMPLETE_ESTIMATE','NEAR_MATCH_ESTIMATE','INCOMPLETE')),
 reconciliation_status text not null check(reconciliation_status in ('MATCH','NEAR_MATCH','REVIEW_REQUIRED','NOT_AVAILABLE')),
 provenance jsonb not null default '{}'::jsonb
);
create table if not exists public.flight_payroll_final_lines(
 id uuid primary key,
 estimate_id uuid not null references public.flight_payroll_final_estimates(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 line_key text not null,
 payroll_reference numeric(12,2),
 exact_seconds bigint,
 amount_minor_units bigint not null,
 metadata jsonb not null default '{}'::jsonb,
 unique(estimate_id,line_key)
);
alter table public.flight_payroll_final_estimates enable row level security;
alter table public.flight_payroll_final_lines enable row level security;
create policy flight_payroll_final_estimates_owner_read on public.flight_payroll_final_estimates for select to authenticated using(user_id=auth.uid());
create policy flight_payroll_final_lines_owner_read on public.flight_payroll_final_lines for select to authenticated using(user_id=auth.uid());
grant select,insert,update,delete on public.flight_payroll_final_estimates,public.flight_payroll_final_lines to service_role;
grant select on public.flight_payroll_final_estimates,public.flight_payroll_final_lines to authenticated;
