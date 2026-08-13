create table if not exists public.flight_trips(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 start_duty_id uuid not null references public.flight_duties(id) on delete cascade,
 end_duty_id uuid not null references public.flight_duties(id) on delete cascade,
 trip_start_at timestamptz not null,
 trip_end_at timestamptz not null,
 contractual_base text not null,
 starts_at_base boolean not null,
 ends_at_base boolean not null,
 away_from_base boolean not null,
 locations jsonb not null default '[]'::jsonb check(jsonb_typeof(locations)='array'),
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(trip_end_at > trip_start_at)
);
create table if not exists public.flight_trip_overnights(
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
 trip_id uuid not null references public.flight_trips(id) on delete cascade,
 previous_duty_id uuid not null references public.flight_duties(id) on delete cascade,
 next_duty_id uuid not null references public.flight_duties(id) on delete cascade,
 location text not null,
 start_at timestamptz not null,
 end_at timestamptz not null,
 hotel_status text not null check(hotel_status in ('USED','WAIVED','UNKNOWN')),
 source text not null check(source in ('DOCUMENT','PROFILE_POLICY','DERIVED_TRIP_CONTINUITY')),
 confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
 provenance jsonb not null default '{}'::jsonb check(jsonb_typeof(provenance)='object'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(end_at > start_at), unique(import_id,previous_duty_id,next_duty_id)
);
create index if not exists flight_trips_import_idx on public.flight_trips(import_id,trip_start_at);
create index if not exists flight_trip_overnights_import_idx on public.flight_trip_overnights(import_id,start_at);
alter table public.flight_trips enable row level security;
alter table public.flight_trip_overnights enable row level security;
create policy flight_trips_owner_read on public.flight_trips for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_trip_overnights_owner_read on public.flight_trip_overnights for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
grant select on public.flight_trips, public.flight_trip_overnights to authenticated;
grant select,insert,update,delete on public.flight_trips, public.flight_trip_overnights to service_role;
do $$ begin create trigger flight_trips_set_updated_at before update on public.flight_trips for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
do $$ begin create trigger flight_trip_overnights_set_updated_at before update on public.flight_trip_overnights for each row execute function public.set_updated_at(); exception when duplicate_object then null; end $$;
