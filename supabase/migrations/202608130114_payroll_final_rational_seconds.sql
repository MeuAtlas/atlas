alter table public.flight_payroll_final_estimates
  alter column guarantee_eligible_total_seconds type numeric(20,6),
  alter column guarantee_consumed_seconds type numeric(20,6),
  alter column normal_within_guarantee_seconds type numeric(20,6),
  alter column normal_above_guarantee_seconds type numeric(20,6),
  alter column total_payroll_reference_seconds type numeric(20,6);
alter table public.flight_payroll_final_lines alter column exact_seconds type numeric(20,6);
