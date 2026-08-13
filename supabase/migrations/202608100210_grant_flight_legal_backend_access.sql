-- A importação desta etapa é exclusivamente server-side e limitada a instrumentos-fontes.
grant select,insert on public.flight_legal_instruments to service_role;
grant insert on public.flight_rule_audit_logs to service_role;
