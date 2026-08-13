-- Atlas Flight: durable, user-isolated results for the structural NetLine parser.
alter table public.flight_schedule_imports
  add column if not exists raw_text text,
  add column if not exists document_type text,
  add column if not exists document_confidence numeric(4,3),
  add column if not exists crew_id text,
  add column if not exists crew_name text,
  add column if not exists home_base text,
  add column if not exists processing_warnings jsonb not null default '[]'::jsonb,
  add column if not exists processing_error_code text,
  add column if not exists processing_error_message text;

create table if not exists public.flight_schedule_pages (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  page_number integer not null check(page_number > 0),
  raw_text text not null,
  created_at timestamptz not null default now(),
  unique(import_id, page_number)
);

create table if not exists public.flight_schedule_days (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  schedule_date date not null,
  day_number smallint not null check(day_number between 1 and 31),
  weekday smallint not null check(weekday between 0 and 6),
  raw_text text not null default '',
  created_at timestamptz not null default now(),
  unique(import_id, schedule_date),
  unique(import_id, day_number)
);

create table if not exists public.flight_schedule_unknown_fields (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.flight_schedule_imports(id) on delete cascade,
  page_number integer check(page_number is null or page_number > 0),
  raw_value text not null,
  raw_line text not null,
  parser_stage text not null check(parser_stage in ('HEADER','DAY_SEGMENTATION','DOCUMENT_STRUCTURE')),
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists flight_schedule_pages_import_page_idx on public.flight_schedule_pages(import_id, page_number);
create index if not exists flight_schedule_days_import_date_idx on public.flight_schedule_days(import_id, schedule_date);
create index if not exists flight_schedule_unknown_fields_import_idx on public.flight_schedule_unknown_fields(import_id);

alter table public.flight_schedule_pages enable row level security;
alter table public.flight_schedule_days enable row level security;
alter table public.flight_schedule_unknown_fields enable row level security;

create policy flight_schedule_pages_owner_read on public.flight_schedule_pages for select to authenticated
  using (exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_schedule_days_owner_read on public.flight_schedule_days for select to authenticated
  using (exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));
create policy flight_schedule_unknown_fields_owner_read on public.flight_schedule_unknown_fields for select to authenticated
  using (exists(select 1 from public.flight_schedule_imports i where i.id=import_id and i.user_id=auth.uid()));

create or replace function public.begin_flight_schedule_processing(p_import_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
  update public.flight_schedule_imports set status='PROCESSING', processing_error_code=null, processing_error_message=null
  where id=p_import_id and user_id=auth.uid();
  if not found then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
end $$;

create or replace function public.persist_flight_schedule_parser_result(
  p_import_id uuid, p_parser_version text, p_status text, p_document_type text,
  p_document_confidence numeric, p_crew_id text, p_crew_name text, p_home_base text,
  p_period_start date, p_period_end date, p_generated_at timestamptz, p_raw_text text,
  p_warnings jsonb, p_error_code text, p_error_message text, p_pages jsonb, p_days jsonb, p_unknown jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare target_import public.flight_schedule_imports;
begin
  if auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into target_import from public.flight_schedule_imports where id=p_import_id and user_id=auth.uid() for update;
  if target_import.id is null then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
  if p_status not in ('PROCESSED','PROCESSED_WITH_WARNINGS','FAILED') then raise exception 'Status de processamento inválido.' using errcode='22023'; end if;
  delete from public.flight_schedule_pages where import_id=p_import_id;
  delete from public.flight_schedule_days where import_id=p_import_id;
  delete from public.flight_schedule_unknown_fields where import_id=p_import_id;
  insert into public.flight_schedule_pages(import_id,page_number,raw_text)
    select p_import_id, x.page_number, x.raw_text from jsonb_to_recordset(coalesce(p_pages,'[]'::jsonb)) as x(page_number integer,raw_text text);
  insert into public.flight_schedule_days(import_id,schedule_date,day_number,weekday,raw_text)
    select p_import_id, x.schedule_date, x.day_number, x.weekday, x.raw_text from jsonb_to_recordset(coalesce(p_days,'[]'::jsonb)) as x(schedule_date date,day_number smallint,weekday smallint,raw_text text);
  insert into public.flight_schedule_unknown_fields(import_id,page_number,raw_value,raw_line,parser_stage,reason)
    select p_import_id, x.page_number, x.raw_value, x.raw_line, x.parser_stage, x.reason from jsonb_to_recordset(coalesce(p_unknown,'[]'::jsonb)) as x(page_number integer,raw_value text,raw_line text,parser_stage text,reason text);
  update public.flight_schedule_imports set parser_version=p_parser_version,status=p_status,document_type=p_document_type,document_confidence=p_document_confidence,
    crew_id=p_crew_id,crew_name=p_crew_name,home_base=p_home_base,document_period_start=p_period_start,document_period_end=p_period_end,
    document_generated_at=p_generated_at,raw_text=p_raw_text,processing_warnings=coalesce(p_warnings,'[]'::jsonb),processing_error_code=p_error_code,processing_error_message=p_error_message,processed_at=now()
  where id=p_import_id;
end $$;

revoke all on function public.begin_flight_schedule_processing(uuid) from public,anon;
revoke all on function public.persist_flight_schedule_parser_result(uuid,text,text,text,numeric,text,text,text,date,date,timestamptz,text,jsonb,text,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.begin_flight_schedule_processing(uuid), public.persist_flight_schedule_parser_result(uuid,text,text,text,numeric,text,text,text,date,date,timestamptz,text,jsonb,text,text,jsonb,jsonb,jsonb) to authenticated;
grant select on public.flight_schedule_pages,public.flight_schedule_days,public.flight_schedule_unknown_fields to authenticated;
