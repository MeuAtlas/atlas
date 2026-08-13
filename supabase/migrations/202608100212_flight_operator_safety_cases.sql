create table public.flight_operator_safety_cases(
 id uuid primary key default gen_random_uuid(), operator_name text not null, safety_case_type text not null check(safety_case_type in('PUJ','TURNAROUND','OTHER')), approval_status text not null default 'UNKNOWN' check(approval_status in('APPROVED','NOT_APPROVED','UNKNOWN')), effective_from date, effective_to date, source_reference text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), check(effective_to is null or effective_from is null or effective_to>=effective_from)
);
alter table public.flight_operator_safety_cases enable row level security;
create policy flight_operator_safety_cases_authenticated_read on public.flight_operator_safety_cases for select to authenticated using(true);
grant select on public.flight_operator_safety_cases to authenticated;
