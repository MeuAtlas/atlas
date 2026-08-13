-- The initial pattern escaped the backslash itself, rejecting valid UUID.pdf paths.
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
  if p_storage_path !~ ('^' || current_user_id::text || '/' || p_year::text || '/' || lpad(p_month::text,2,'0') || '/(planned|execution)/[0-9a-f-]+\.pdf$') then raise exception 'Caminho do arquivo inválido.' using errcode='22023'; end if;

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
