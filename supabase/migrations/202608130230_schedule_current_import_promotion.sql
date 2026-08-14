-- Stage first, then atomically promote only a processed import. Previous versions remain auditable.
alter table public.flight_schedule_imports add column if not exists superseded_at timestamptz;

create or replace function public.stage_flight_schedule_import(p_year smallint, p_month smallint, p_role text, p_original_filename text, p_storage_path text, p_file_size bigint, p_file_hash_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_user_id uuid := auth.uid(); target_month public.flight_schedule_months; duplicate_import public.flight_schedule_imports; next_snapshot integer; target_import public.flight_schedule_imports; period_first date;
begin
 if current_user_id is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
 if p_year not between 2000 and 2100 or p_month not between 1 and 12 or p_role not in ('PLANNED','EXECUTION_SNAPSHOT') or p_file_hash_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Dados de importação inválidos.' using errcode='22023'; end if;
 period_first := make_date(p_year,p_month,1);
 insert into public.flight_schedule_months(user_id,year,month,period_start,period_end) values(current_user_id,p_year,p_month,period_first,(period_first + interval '1 month - 1 day')::date) on conflict(user_id,year,month) do nothing;
 select * into target_month from public.flight_schedule_months where user_id=current_user_id and year=p_year and month=p_month for update;
 if target_month.status <> 'OPEN' then raise exception 'Este mês operacional já está fechado.' using errcode='22023'; end if;
 select * into duplicate_import from public.flight_schedule_imports where schedule_month_id=target_month.id and file_hash_sha256=p_file_hash_sha256;
 if found then return jsonb_build_object('status','existing','importId',duplicate_import.id); end if;
 select coalesce(max(snapshot_number),0)+1 into next_snapshot from public.flight_schedule_imports where schedule_month_id=target_month.id and p_role='EXECUTION_SNAPSHOT';
 insert into public.flight_schedule_imports(schedule_month_id,user_id,schedule_role,snapshot_number,original_filename,storage_path,file_size,file_hash_sha256) values(target_month.id,current_user_id,p_role,case when p_role='EXECUTION_SNAPSHOT' then next_snapshot else null end,p_original_filename,p_storage_path,p_file_size,p_file_hash_sha256) returning * into target_import;
 return jsonb_build_object('status','staged','importId',target_import.id);
end $$;

create or replace function public.promote_flight_schedule_import(p_import_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_user_id uuid := auth.uid(); target_import public.flight_schedule_imports; target_month public.flight_schedule_months; old_import_id uuid;
begin
 select * into target_import from public.flight_schedule_imports where id=p_import_id and user_id=current_user_id for update;
 if not found then raise exception 'Importação não encontrada.' using errcode='42501'; end if;
 if target_import.status not in ('PROCESSED','PROCESSED_WITH_WARNINGS') then raise exception 'A escala ainda não foi processada com sucesso.' using errcode='22023'; end if;
 select * into target_month from public.flight_schedule_months where id=target_import.schedule_month_id for update;
 if target_import.document_period_start is null or extract(year from target_import.document_period_start) <> target_month.year or extract(month from target_import.document_period_start) <> target_month.month then raise exception 'Este documento pertence a outra competência.' using errcode='22023'; end if;
 if target_import.schedule_role='PLANNED' then
  old_import_id := target_month.planned_import_id; update public.flight_schedule_months set planned_import_id=target_import.id where id=target_month.id;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata) values(current_user_id,target_month.id,target_import.id,'PLANNED_SCHEDULE_IMPORTED',current_user_id,jsonb_build_object('event','SCHEDULE_PLANNED_REPLACED','oldImportId',old_import_id));
 else
  old_import_id := target_month.current_execution_import_id; update public.flight_schedule_months set current_execution_import_id=target_import.id where id=target_month.id;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata) values(current_user_id,target_month.id,target_import.id,'EXECUTION_SNAPSHOT_IMPORTED',current_user_id,jsonb_build_object('event','SCHEDULE_EXECUTION_UPDATED','oldImportId',old_import_id));
 end if;
 if old_import_id is not null and old_import_id <> target_import.id then update public.flight_schedule_imports set superseded_at=now() where id=old_import_id; end if;
 return jsonb_build_object('status','promoted','importId',target_import.id,'previousImportId',old_import_id);
end $$;

revoke all on function public.stage_flight_schedule_import(smallint,smallint,text,text,text,bigint,text) from public,anon;
revoke all on function public.promote_flight_schedule_import(uuid) from public,anon;
grant execute on function public.stage_flight_schedule_import(smallint,smallint,text,text,text,bigint,text), public.promote_flight_schedule_import(uuid) to authenticated;
