-- Atlas Flight: immutable planned schedules and preserved execution snapshots.
insert into public.modules (slug,name,description,icon,route,category,is_default)
values ('escala','Escala','Sua programação operacional e histórico de escalas.','plane','/escala','professional',true)
on conflict (slug) do update set
  name=excluded.name,
  description=excluded.description,
  icon=excluded.icon,
  route=excluded.route,
  category=excluded.category,
  is_default=excluded.is_default;

-- Make the newly-default module available to existing Atlas users as well.
insert into public.user_modules(user_id,module_id,enabled,permission_level,enabled_at)
select profile.id,module.id,true,'owner',now()
from public.profiles profile
cross join public.modules module
where module.slug='escala'
on conflict (user_id,module_id) do nothing;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('flight-schedules','flight-schedules',false,20971520,array['application/pdf'])
on conflict (id) do update set
  public=false,
  file_size_limit=20971520,
  allowed_mime_types=array['application/pdf'];

create table if not exists public.flight_schedule_months(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year smallint not null check(year between 2000 and 2100),
  month smallint not null check(month between 1 and 12),
  period_start date not null,
  period_end date not null,
  home_base text,
  status text not null default 'OPEN' check(status in ('OPEN','CLOSED')),
  planned_import_id uuid,
  current_execution_import_id uuid,
  final_execution_import_id uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(period_start = make_date(year,month,1)),
  check(period_end = (make_date(year,month,1) + interval '1 month - 1 day')::date),
  check((status='OPEN' and closed_at is null) or (status='CLOSED' and closed_at is not null)),
  unique(user_id,year,month)
);

create table if not exists public.flight_schedule_imports(
  id uuid primary key default gen_random_uuid(),
  schedule_month_id uuid not null references public.flight_schedule_months(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_role text not null check(schedule_role in ('PLANNED','EXECUTION_SNAPSHOT','FINAL_EXECUTED')),
  snapshot_number integer check(snapshot_number is null or snapshot_number > 0),
  storage_bucket text not null default 'flight-schedules' check(storage_bucket='flight-schedules'),
  original_filename text not null,
  storage_path text not null,
  mime_type text not null check(mime_type='application/pdf'),
  file_size bigint not null check(file_size > 0 and file_size <= 20971520),
  file_hash_sha256 text not null check(file_hash_sha256 ~ '^[a-f0-9]{64}$'),
  source text not null default 'NETLINE_GOL' check(source in ('NETLINE_GOL')),
  status text not null default 'PENDING_PROCESSING' check(status in ('UPLOADED','PENDING_PROCESSING','PROCESSING','PROCESSED','PROCESSED_WITH_WARNINGS','FAILED')),
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  document_period_start date,
  document_period_end date,
  document_generated_at timestamptz,
  parser_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((schedule_role='EXECUTION_SNAPSHOT' and snapshot_number is not null) or (schedule_role <> 'EXECUTION_SNAPSHOT' and snapshot_number is null)),
  unique(storage_bucket,storage_path),
  unique(schedule_month_id,file_hash_sha256),
  unique(schedule_month_id,snapshot_number)
);

alter table public.flight_schedule_months
  add constraint flight_schedule_months_planned_import_fk foreign key(planned_import_id) references public.flight_schedule_imports(id) on delete restrict,
  add constraint flight_schedule_months_current_execution_import_fk foreign key(current_execution_import_id) references public.flight_schedule_imports(id) on delete restrict,
  add constraint flight_schedule_months_final_execution_import_fk foreign key(final_execution_import_id) references public.flight_schedule_imports(id) on delete restrict;

create table if not exists public.flight_schedule_audit_logs(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  schedule_month_id uuid references public.flight_schedule_months(id) on delete cascade,
  import_id uuid references public.flight_schedule_imports(id) on delete set null,
  action text not null check(action in ('SCHEDULE_MONTH_CREATED','PLANNED_SCHEDULE_IMPORTED','EXECUTION_SNAPSHOT_IMPORTED','EXECUTION_SNAPSHOT_PROMOTED_TO_FINAL','SCHEDULE_MONTH_CLOSED')),
  performed_by uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists flight_schedule_imports_month_created_idx on public.flight_schedule_imports(schedule_month_id,created_at desc);
create index if not exists flight_schedule_audit_logs_month_created_idx on public.flight_schedule_audit_logs(schedule_month_id,created_at desc);

do $$ begin
  create trigger flight_schedule_months_set_updated_at before update on public.flight_schedule_months for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
do $$ begin
  create trigger flight_schedule_imports_set_updated_at before update on public.flight_schedule_imports for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

alter table public.flight_schedule_months enable row level security;
alter table public.flight_schedule_imports enable row level security;
alter table public.flight_schedule_audit_logs enable row level security;

create policy flight_schedule_months_owner_read on public.flight_schedule_months for select to authenticated using(user_id=auth.uid());
create policy flight_schedule_imports_owner_read on public.flight_schedule_imports for select to authenticated using(user_id=auth.uid());
create policy flight_schedule_audit_logs_owner_read on public.flight_schedule_audit_logs for select to authenticated using(user_id=auth.uid());

drop policy if exists flight_schedules_select on storage.objects;
drop policy if exists flight_schedules_insert on storage.objects;
drop policy if exists flight_schedules_delete on storage.objects;
create policy flight_schedules_select on storage.objects for select to authenticated
  using(bucket_id='flight-schedules' and (storage.foldername(name))[1]=auth.uid()::text);
create policy flight_schedules_insert on storage.objects for insert to authenticated
  with check(bucket_id='flight-schedules' and (storage.foldername(name))[1]=auth.uid()::text);
create policy flight_schedules_delete on storage.objects for delete to authenticated
  using(bucket_id='flight-schedules' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.create_flight_schedule_import(
  p_year smallint,
  p_month smallint,
  p_role text,
  p_original_filename text,
  p_storage_path text,
  p_file_size bigint,
  p_file_hash_sha256 text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  current_user_id uuid := auth.uid();
  target_month public.flight_schedule_months;
  target_import public.flight_schedule_imports;
  duplicate_import public.flight_schedule_imports;
  next_snapshot integer;
  period_first date;
  inserted_month_count integer;
begin
  if current_user_id is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then raise exception 'Mês operacional inválido.' using errcode='22023'; end if;
  if p_role not in ('PLANNED','EXECUTION_SNAPSHOT') then raise exception 'Papel de escala inválido.' using errcode='22023'; end if;
  if p_file_hash_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Hash inválido.' using errcode='22023'; end if;
  if p_storage_path !~ ('^' || current_user_id::text || '/' || p_year::text || '/' || lpad(p_month::text,2,'0') || '/(planned|execution)/[0-9a-f-]+\\.pdf$') then raise exception 'Caminho do arquivo inválido.' using errcode='22023'; end if;

  period_first := make_date(p_year,p_month,1);
  insert into public.flight_schedule_months(user_id,year,month,period_start,period_end)
  values(current_user_id,p_year,p_month,period_first,(period_first + interval '1 month - 1 day')::date)
  on conflict(user_id,year,month) do nothing;
  get diagnostics inserted_month_count = row_count;

  select * into target_month from public.flight_schedule_months
  where user_id=current_user_id and year=p_year and month=p_month for update;
  if target_month.status <> 'OPEN' then raise exception 'Este mês operacional já está fechado.' using errcode='22023'; end if;

  select * into duplicate_import from public.flight_schedule_imports
  where schedule_month_id=target_month.id and file_hash_sha256=p_file_hash_sha256;
  if found then return jsonb_build_object('status','existing','importId',duplicate_import.id,'snapshotNumber',duplicate_import.snapshot_number); end if;
  if p_role='PLANNED' and target_month.planned_import_id is not null then raise exception 'A escala planejada já foi definida e não pode ser substituída.' using errcode='23505'; end if;

  if p_role='EXECUTION_SNAPSHOT' then
    select coalesce(max(snapshot_number),0)+1 into next_snapshot from public.flight_schedule_imports where schedule_month_id=target_month.id;
  else next_snapshot := null; end if;

  insert into public.flight_schedule_imports(schedule_month_id,user_id,schedule_role,snapshot_number,original_filename,storage_path,file_size,file_hash_sha256)
  values(target_month.id,current_user_id,p_role,next_snapshot,p_original_filename,p_storage_path,p_file_size,p_file_hash_sha256)
  returning * into target_import;

  if p_role='PLANNED' then
    update public.flight_schedule_months set planned_import_id=target_import.id where id=target_month.id;
    insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata)
    values(current_user_id,target_month.id,target_import.id,'PLANNED_SCHEDULE_IMPORTED',current_user_id,jsonb_build_object('filename',p_original_filename));
  else
    update public.flight_schedule_months set current_execution_import_id=target_import.id where id=target_month.id;
    insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata)
    values(current_user_id,target_month.id,target_import.id,'EXECUTION_SNAPSHOT_IMPORTED',current_user_id,jsonb_build_object('filename',p_original_filename,'snapshotNumber',next_snapshot));
  end if;
  if inserted_month_count = 1 then
    insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,action,performed_by)
    values(current_user_id,target_month.id,'SCHEDULE_MONTH_CREATED',current_user_id);
  end if;
  return jsonb_build_object('status','created','importId',target_import.id,'snapshotNumber',next_snapshot);
end $$;

revoke all on function public.create_flight_schedule_import(smallint,smallint,text,text,text,bigint,text) from public,anon;
grant execute on function public.create_flight_schedule_import(smallint,smallint,text,text,text,bigint,text) to authenticated;
grant select on public.flight_schedule_months,public.flight_schedule_imports,public.flight_schedule_audit_logs to authenticated;
