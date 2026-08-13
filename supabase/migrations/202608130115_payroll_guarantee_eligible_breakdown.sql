alter table public.flight_payroll_final_estimates
  add column if not exists guarantee_eligible_operating_seconds numeric(20,6) not null default 0,
  add column if not exists guarantee_eligible_deadhead_seconds numeric(20,6) not null default 0,
  add column if not exists guarantee_eligible_standby_equivalent_seconds numeric(20,6) not null default 0,
  add column if not exists guarantee_eligible_reserve_seconds numeric(20,6) not null default 0;
