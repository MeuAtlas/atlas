create table public.flight_schedule_events (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  schedule_day_id uuid not null references public.flight_schedule_days(id) on delete cascade,
  event_type text not null check(event_type in ('OFF','STANDBY','COURSE','TRAINING','EVALUATION','DEADHEAD','CHECK_IN','CHECK_OUT','GROUND_ACTIVITY','UNKNOWN')),
  event_code text not null,
  event_label text,
  sequence smallint not null check(sequence > 0),
  start_time_local time,
  end_time_local time,
  location_airport text,
  raw_text text not null,
  raw_metadata jsonb not null default '{}'::jsonb,
  confidence text not null check(confidence in ('HIGH','MEDIUM','LOW')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(schedule_day_id,sequence)
);
create table public.flight_schedule_legends (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  code text not null,
  description text,
  raw_text text not null,
  created_at timestamptz not null default now(),
  unique(import_id,code)
);
create index flight_schedule_events_import_idx on public.flight_schedule_events(import_id);
create index flight_schedule_events_day_idx on public.flight_schedule_events(schedule_day_id);
create index flight_schedule_events_type_code_idx on public.flight_schedule_events(event_type,event_code);
alter table public.flight_schedule_events enable row level security;
alter table public.flight_schedule_legends enable row level security;
create policy flight_schedule_events_owner_read on public.flight_schedule_events for select to authenticated using(exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_schedule_legends_owner_read on public.flight_schedule_legends for select to authenticated using(exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));

create or replace function public.persist_flight_schedule_activities(p_import_id uuid,p_events jsonb,p_legends jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(select 1 from public.flight_schedule_imports where id=p_import_id and user_id=auth.uid()) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  delete from public.flight_schedule_events where import_id=p_import_id;
  delete from public.flight_schedule_legends where import_id=p_import_id;
  insert into public.flight_schedule_legends(import_id,code,description,raw_text)
    select p_import_id,x.code,x.description,x.raw_text from jsonb_to_recordset(coalesce(p_legends,'[]'::jsonb)) x(code text,description text,raw_text text);
  insert into public.flight_schedule_events(import_id,schedule_day_id,event_type,event_code,event_label,sequence,start_time_local,end_time_local,location_airport,raw_text,raw_metadata,confidence)
    select p_import_id,d.id,x.event_type,x.event_code,x.event_label,x.sequence,x.start_time_local,x.end_time_local,x.location_airport,x.raw_text,coalesce(x.raw_metadata,'{}'::jsonb),x.confidence
    from jsonb_to_recordset(coalesce(p_events,'[]'::jsonb)) x(schedule_date date,event_type text,event_code text,event_label text,sequence smallint,start_time_local time,end_time_local time,location_airport text,raw_text text,raw_metadata jsonb,confidence text)
    join public.flight_schedule_days d on d.import_id=p_import_id and d.schedule_date=x.schedule_date;
end $$;
revoke all on function public.persist_flight_schedule_activities(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.persist_flight_schedule_activities(uuid,jsonb,jsonb) to authenticated;
grant select on public.flight_schedule_events,public.flight_schedule_legends to authenticated;
