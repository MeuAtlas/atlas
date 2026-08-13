alter table public.flight_trips alter column start_duty_id drop not null;
alter table public.flight_trips alter column end_duty_id drop not null;
alter table public.flight_trip_overnights alter column previous_duty_id drop not null;
alter table public.flight_trip_overnights alter column next_duty_id drop not null;
