-- Allows the server-only processing service to re-run an owned import.
-- Authenticated callers remain constrained to their own import through auth.uid().
create or replace function public.begin_flight_schedule_processing(p_import_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  is_service boolean := auth.role() = 'service_role';
begin
  if auth.uid() is null and not is_service then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;

  update public.flight_schedule_imports
  set status='PROCESSING', processing_error_code=null, processing_error_message=null
  where id=p_import_id and (is_service or user_id=auth.uid());

  if not found then
    raise exception 'Importação não encontrada.' using errcode='P0002';
  end if;
end $$;

create or replace function public.persist_flight_schedule_parser_result(
  p_import_id uuid, p_parser_version text, p_status text, p_document_type text,
  p_document_confidence numeric, p_crew_id text, p_crew_name text, p_home_base text,
  p_period_start date, p_period_end date, p_generated_at timestamptz, p_raw_text text,
  p_warnings jsonb, p_error_code text, p_error_message text, p_pages jsonb, p_days jsonb, p_unknown jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare
  target_import public.flight_schedule_imports;
  is_service boolean := auth.role() = 'service_role';
begin
  if auth.uid() is null and not is_service then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into target_import from public.flight_schedule_imports
  where id=p_import_id and (is_service or user_id=auth.uid()) for update;
  if target_import.id is null then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
  if p_status not in ('PROCESSED','PROCESSED_WITH_WARNINGS','FAILED') then raise exception 'Status de processamento inválido.' using errcode='22023'; end if;
  delete from public.flight_schedule_pages where import_id=p_import_id;
  delete from public.flight_schedule_days where import_id=p_import_id;
  delete from public.flight_schedule_unknown_fields where import_id=p_import_id;
  insert into public.flight_schedule_pages(import_id,page_number,raw_text)
    select p_import_id,x.page_number,x.raw_text from jsonb_to_recordset(coalesce(p_pages,'[]'::jsonb)) x(page_number integer,raw_text text);
  insert into public.flight_schedule_days(import_id,schedule_date,day_number,weekday,raw_text)
    select p_import_id,x.schedule_date,x.day_number,x.weekday,x.raw_text from jsonb_to_recordset(coalesce(p_days,'[]'::jsonb)) x(schedule_date date,day_number smallint,weekday smallint,raw_text text);
  insert into public.flight_schedule_unknown_fields(import_id,page_number,raw_value,raw_line,parser_stage,reason)
    select p_import_id,x.page_number,x.raw_value,x.raw_line,x.parser_stage,x.reason from jsonb_to_recordset(coalesce(p_unknown,'[]'::jsonb)) x(page_number integer,raw_value text,raw_line text,parser_stage text,reason text);
  update public.flight_schedule_imports set parser_version=p_parser_version,status=p_status,document_type=p_document_type,document_confidence=p_document_confidence,
    crew_id=p_crew_id,crew_name=p_crew_name,home_base=p_home_base,document_period_start=p_period_start,document_period_end=p_period_end,
    document_generated_at=p_generated_at,raw_text=p_raw_text,processing_warnings=coalesce(p_warnings,'[]'::jsonb),processing_error_code=p_error_code,processing_error_message=p_error_message,processed_at=now()
  where id=p_import_id;
end $$;

create or replace function public.persist_flight_schedule_activities(p_import_id uuid,p_events jsonb,p_legends jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare is_service boolean := auth.role() = 'service_role';
begin
  if (auth.uid() is null and not is_service) or not exists(select 1 from public.flight_schedule_imports where id=p_import_id and (is_service or user_id=auth.uid())) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  delete from public.flight_schedule_events where import_id=p_import_id;
  delete from public.flight_schedule_legends where import_id=p_import_id;
  insert into public.flight_schedule_legends(import_id,code,description,raw_text)
    select p_import_id,x.code,x.description,x.raw_text from jsonb_to_recordset(coalesce(p_legends,'[]'::jsonb)) x(code text,description text,raw_text text);
  insert into public.flight_schedule_events(import_id,schedule_day_id,event_type,event_code,event_label,sequence,start_time_local,end_time_local,location_airport,raw_text,raw_metadata,confidence)
    select p_import_id,d.id,x.event_type,x.event_code,x.event_label,x.sequence,x.start_time_local,x.end_time_local,x.location_airport,x.raw_text,coalesce(x.raw_metadata,'{}'::jsonb),x.confidence
    from jsonb_to_recordset(coalesce(p_events,'[]'::jsonb)) x(schedule_date date,event_type text,event_code text,event_label text,sequence smallint,start_time_local time,end_time_local time,location_airport text,raw_text text,raw_metadata jsonb,confidence text)
    join public.flight_schedule_days d on d.import_id=p_import_id and d.schedule_date=x.schedule_date;
end $$;

create or replace function public.persist_flight_structure(p_import_id uuid,p_duties jsonb,p_legs jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare is_service boolean := auth.role() = 'service_role';
begin
 if (auth.uid() is null and not is_service) or not exists(select 1 from public.flight_schedule_imports where id=p_import_id and (is_service or user_id=auth.uid())) then raise exception 'Acesso negado.' using errcode='42501'; end if;
 delete from public.flight_legs where import_id=p_import_id; delete from public.flight_duties where import_id=p_import_id;
 insert into public.flight_duties(import_id,sequence,start_date,end_date,check_in_airport,check_out_airport,check_in_time_local,check_out_time_local,check_in_outside_homebase_timezone,check_out_outside_homebase_timezone,status,confidence,raw_metadata)
 select p_import_id,x.sequence,x.start_date,x.end_date,x.check_in_airport,x.check_out_airport,x.check_in_time_local,x.check_out_time_local,coalesce(x.check_in_outside_homebase_timezone,false),coalesce(x.check_out_outside_homebase_timezone,false),x.status,x.confidence,coalesce(x.raw_metadata,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_duties,'[]'::jsonb)) x(sequence smallint,start_date date,end_date date,check_in_airport text,check_out_airport text,check_in_time_local time,check_out_time_local time,check_in_outside_homebase_timezone boolean,check_out_outside_homebase_timezone boolean,status text,confidence text,raw_metadata jsonb);
 insert into public.flight_legs(import_id,schedule_day_id,duty_id,sequence,leg_type,carrier_code,flight_number,origin,destination,departure_date,arrival_date,departure_time_local,arrival_time_local,departure_outside_homebase_timezone,arrival_outside_homebase_timezone,aircraft_code,raw_departure,raw_arrival,raw_text,raw_metadata,confidence)
 select p_import_id,d.id,du.id,x.sequence,x.leg_type,x.carrier_code,x.flight_number,x.origin,x.destination,x.departure_date,x.arrival_date,x.departure_time_local,x.arrival_time_local,coalesce(x.departure_outside_homebase_timezone,false),coalesce(x.arrival_outside_homebase_timezone,false),x.aircraft_code,x.raw_departure,x.raw_arrival,x.raw_text,coalesce(x.raw_metadata,'{}'::jsonb),x.confidence from jsonb_to_recordset(coalesce(p_legs,'[]'::jsonb)) x(schedule_date date,duty_sequence smallint,sequence smallint,leg_type text,carrier_code text,flight_number text,origin text,destination text,departure_date date,arrival_date date,departure_time_local time,arrival_time_local time,departure_outside_homebase_timezone boolean,arrival_outside_homebase_timezone boolean,aircraft_code text,raw_departure text,raw_arrival text,raw_text text,raw_metadata jsonb,confidence text) join public.flight_schedule_days d on d.import_id=p_import_id and d.schedule_date=x.schedule_date left join public.flight_duties du on du.import_id=p_import_id and du.sequence=x.duty_sequence;
end $$;

grant execute on function public.begin_flight_schedule_processing(uuid), public.persist_flight_schedule_parser_result(uuid,text,text,text,numeric,text,text,text,date,date,timestamptz,text,jsonb,text,text,jsonb,jsonb,jsonb), public.persist_flight_schedule_activities(uuid,jsonb,jsonb), public.persist_flight_structure(uuid,jsonb,jsonb) to authenticated, service_role;
