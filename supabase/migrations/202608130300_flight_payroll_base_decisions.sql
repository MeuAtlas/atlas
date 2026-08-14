create table if not exists public.flight_payroll_base_decisions(
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_month_id uuid not null references public.flight_schedule_months(id) on delete cascade,
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  planned_import_id uuid not null references public.flight_schedule_imports(id) on delete restrict,
  executed_import_id uuid not null references public.flight_schedule_imports(id) on delete restrict,
  planned_gross_amount_minor_units bigint,
  executed_gross_amount_minor_units bigint,
  planned_net_amount_minor_units bigint,
  executed_net_amount_minor_units bigint,
  selected_scenario text not null check(selected_scenario in ('PLANNED','EXECUTED','TIE','UNAVAILABLE')),
  gross_difference_minor_units bigint,
  decision_reason text not null check(decision_reason in ('HIGHER_GROSS_PAY','EQUAL_GROSS_PAY','SCENARIO_UNAVAILABLE')),
  engine_version text not null,
  provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(schedule_month_id,planned_import_id,executed_import_id)
);

create index if not exists flight_payroll_base_decisions_month_idx on public.flight_payroll_base_decisions(schedule_month_id,created_at desc);
do $$ begin create trigger flight_payroll_base_decisions_set_updated_at before update on public.flight_payroll_base_decisions for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
alter table public.flight_payroll_base_decisions enable row level security;
create policy flight_payroll_base_decisions_owner_read on public.flight_payroll_base_decisions for select to authenticated using(user_id=auth.uid());
grant select,insert,update,delete on public.flight_payroll_base_decisions to service_role;
grant select on public.flight_payroll_base_decisions to authenticated;
