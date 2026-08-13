alter table public.flight_legs
  add column if not exists duty_link_status text not null default 'LINKED'
  check (duty_link_status in ('LINKED','UNLINKED_DOCUMENT_NO_CI_CO','UNLINKED_AMBIGUOUS'));

create index if not exists flight_legs_import_duty_link_status_idx on public.flight_legs(import_id,duty_link_status);

create or replace function public.persist_flight_structure(p_import_id uuid,p_duties jsonb,p_legs jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare is_service boolean := auth.role() = 'service_role';
begin
 if (auth.uid() is null and not is_service) or not exists(select 1 from public.flight_schedule_imports where id=p_import_id and (is_service or user_id=auth.uid())) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 delete from public.flight_legs where import_id=p_import_id; delete from public.flight_duties where import_id=p_import_id;
 insert into public.flight_duties(import_id,sequence,start_date,end_date,check_in_airport,check_out_airport,check_in_time_local,check_out_time_local,check_in_outside_homebase_timezone,check_out_outside_homebase_timezone,status,confidence,raw_metadata)
 select p_import_id,x.sequence,x.start_date,x.end_date,x.check_in_airport,x.check_out_airport,x.check_in_time_local,x.check_out_time_local,coalesce(x.check_in_outside_homebase_timezone,false),coalesce(x.check_out_outside_homebase_timezone,false),x.status,x.confidence,coalesce(x.raw_metadata,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_duties,'[]'::jsonb)) x(sequence smallint,start_date date,end_date date,check_in_airport text,check_out_airport text,check_in_time_local time,check_out_time_local time,check_in_outside_homebase_timezone boolean,check_out_outside_homebase_timezone boolean,status text,confidence text,raw_metadata jsonb);
 insert into public.flight_legs(import_id,schedule_day_id,duty_id,duty_link_status,sequence,leg_type,carrier_code,flight_number,origin,destination,departure_date,arrival_date,departure_time_local,arrival_time_local,departure_outside_homebase_timezone,arrival_outside_homebase_timezone,aircraft_code,raw_departure,raw_arrival,raw_text,raw_metadata,confidence)
 select p_import_id,d.id,du.id,x.duty_link_status,x.sequence,x.leg_type,x.carrier_code,x.flight_number,x.origin,x.destination,x.departure_date,x.arrival_date,x.departure_time_local,x.arrival_time_local,coalesce(x.departure_outside_homebase_timezone,false),coalesce(x.arrival_outside_homebase_timezone,false),x.aircraft_code,x.raw_departure,x.raw_arrival,x.raw_text,coalesce(x.raw_metadata,'{}'::jsonb),x.confidence from jsonb_to_recordset(coalesce(p_legs,'[]'::jsonb)) x(schedule_date date,duty_sequence smallint,duty_link_status text,sequence smallint,leg_type text,carrier_code text,flight_number text,origin text,destination text,departure_date date,arrival_date date,departure_time_local time,arrival_time_local time,departure_outside_homebase_timezone boolean,arrival_outside_homebase_timezone boolean,aircraft_code text,raw_departure text,raw_arrival text,raw_text text,raw_metadata jsonb,confidence text) join public.flight_schedule_days d on d.import_id=p_import_id and d.schedule_date=x.schedule_date left join public.flight_duties du on du.import_id=p_import_id and du.sequence=x.duty_sequence;
end $$;

grant execute on function public.persist_flight_structure(uuid,jsonb,jsonb) to authenticated, service_role;
