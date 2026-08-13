-- The service role is used only by server-side diagnostics. It bypasses RLS,
-- but still needs explicit SQL privileges on Flight tables created after the
-- initial schema grants.
grant select on public.flight_schedule_months, public.flight_schedule_imports,
  public.flight_schedule_days, public.flight_schedule_events,
  public.flight_schedule_legends, public.flight_schedule_unknown_fields,
  public.flight_schedule_audit_logs, public.flight_legs, public.flight_duties
to service_role;
