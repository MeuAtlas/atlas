-- Rules Engine needs the owner-scoped contractual profile only on the server.
grant select on public.flight_legal_profile_facts to service_role;
