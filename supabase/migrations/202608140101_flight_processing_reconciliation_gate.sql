-- Canonical processing completeness gate. A parsed import is only promotable when
-- its structured operating FT reconciles with the documentary monthly FT.
alter table public.flight_schedule_imports drop constraint if exists flight_schedule_imports_status_check;
alter table public.flight_schedule_imports
  add constraint flight_schedule_imports_status_check check(status in ('UPLOADED','PENDING_PROCESSING','PROCESSING','PROCESSED','PROCESSED_WITH_WARNINGS','INCOMPLETE','FAILED')),
  add column if not exists reconciliation_status text not null default 'UNKNOWN' check(reconciliation_status in ('VALID','INCOMPLETE','UNKNOWN')),
  add column if not exists documented_flight_time_minutes integer check(documented_flight_time_minutes is null or documented_flight_time_minutes >= 0),
  add column if not exists processed_flight_time_minutes integer check(processed_flight_time_minutes is null or processed_flight_time_minutes >= 0),
  add column if not exists flight_time_difference_minutes integer,
  add column if not exists missing_flight_time_minutes integer check(missing_flight_time_minutes is null or missing_flight_time_minutes >= 0),
  add column if not exists reconciliation_threshold_minutes integer not null default 5 check(reconciliation_threshold_minutes >= 0),
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_attempt_count integer not null default 0 check(processing_attempt_count >= 0),
  add column if not exists last_reprocessed_at timestamptz;

alter table public.flight_schedule_audit_logs drop constraint if exists flight_schedule_audit_logs_action_check;
alter table public.flight_schedule_audit_logs add constraint flight_schedule_audit_logs_action_check check(action in (
  'SCHEDULE_MONTH_CREATED','PLANNED_SCHEDULE_IMPORTED','EXECUTION_SNAPSHOT_IMPORTED','EXECUTION_SNAPSHOT_DELETED','EXECUTION_SNAPSHOT_PROMOTED_TO_FINAL','SCHEDULE_MONTH_CLOSED',
  'REPROCESSING_STARTED','REPROCESSING_COMPLETED','REPROCESSING_FAILED','PROCESSING_INCOMPLETE'
));

create or replace function public.begin_flight_schedule_processing(p_import_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target public.flight_schedule_imports; is_service boolean := auth.role() = 'service_role'; actor uuid;
begin
  if auth.uid() is null and not is_service then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into target from public.flight_schedule_imports where id=p_import_id and (is_service or user_id=auth.uid()) for update;
  if not found then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
  if target.processing_started_at > now() - interval '15 minutes' then
    raise exception 'Esta escala já está sendo processada.' using errcode='55000';
  end if;
  actor := coalesce(auth.uid(), target.user_id);
  update public.flight_schedule_imports set status='PROCESSING',processing_started_at=now(),processing_attempt_count=processing_attempt_count+1,
    reconciliation_status='UNKNOWN',processing_error_code=null,processing_error_message=null where id=p_import_id;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata)
  values(target.user_id,target.schedule_month_id,target.id,'REPROCESSING_STARTED',actor,jsonb_build_object('attempt',target.processing_attempt_count+1));
end $$;

create or replace function public.persist_flight_schedule_reconciliation(
  p_import_id uuid, p_reconciliation_status text, p_documented_minutes integer,
  p_processed_minutes integer, p_difference_minutes integer, p_missing_minutes integer,
  p_threshold_minutes integer, p_processing_status text, p_error_code text, p_error_message text
) returns void language plpgsql security definer set search_path='' as $$
declare target public.flight_schedule_imports; is_service boolean := auth.role() = 'service_role'; actor uuid; audit_action text;
begin
  if auth.uid() is null and not is_service then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into target from public.flight_schedule_imports where id=p_import_id and (is_service or user_id=auth.uid()) for update;
  if not found then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
  if p_reconciliation_status not in ('VALID','INCOMPLETE','UNKNOWN') or p_processing_status not in ('PROCESSED','PROCESSED_WITH_WARNINGS','INCOMPLETE','FAILED') then raise exception 'Estado de reconciliação inválido.' using errcode='22023'; end if;
  if p_processing_status in ('PROCESSED','PROCESSED_WITH_WARNINGS') and p_reconciliation_status <> 'VALID' then raise exception 'Processamento concluído exige reconciliação válida.' using errcode='22023'; end if;
  actor := coalesce(auth.uid(),target.user_id);
  audit_action := case when p_processing_status='INCOMPLETE' then 'PROCESSING_INCOMPLETE' when p_processing_status='FAILED' then 'REPROCESSING_FAILED' else 'REPROCESSING_COMPLETED' end;
  update public.flight_schedule_imports set status=p_processing_status,reconciliation_status=p_reconciliation_status,
    documented_flight_time_minutes=p_documented_minutes,processed_flight_time_minutes=p_processed_minutes,
    flight_time_difference_minutes=p_difference_minutes,missing_flight_time_minutes=p_missing_minutes,
    reconciliation_threshold_minutes=p_threshold_minutes,processing_error_code=p_error_code,processing_error_message=p_error_message,
    processing_started_at=null,last_reprocessed_at=now(),processed_at=now() where id=p_import_id;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata)
  values(target.user_id,target.schedule_month_id,target.id,audit_action,actor,jsonb_build_object(
    'reconciliationStatus',p_reconciliation_status,'documentedMinutes',p_documented_minutes,'processedMinutes',p_processed_minutes,
    'differenceMinutes',p_difference_minutes,'missingMinutes',p_missing_minutes,'thresholdMinutes',p_threshold_minutes,'errorCode',p_error_code));
end $$;

create or replace function public.promote_flight_schedule_import(p_import_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare current_user_id uuid := auth.uid(); target_import public.flight_schedule_imports; target_month public.flight_schedule_months; old_import_id uuid;
begin
 select * into target_import from public.flight_schedule_imports where id=p_import_id and user_id=current_user_id for update;
 if not found then raise exception 'Importação não encontrada.' using errcode='42501'; end if;
 if target_import.status not in ('PROCESSED','PROCESSED_WITH_WARNINGS') or target_import.reconciliation_status <> 'VALID' then raise exception 'A escala ainda não foi processada e reconciliada com sucesso.' using errcode='22023'; end if;
 select * into target_month from public.flight_schedule_months where id=target_import.schedule_month_id for update;
 if target_import.document_period_start is null or extract(year from target_import.document_period_start) <> target_month.year or extract(month from target_import.document_period_start) <> target_month.month then raise exception 'Este documento pertence a outra competência.' using errcode='22023'; end if;
 if target_import.schedule_role='PLANNED' then old_import_id:=target_month.planned_import_id; update public.flight_schedule_months set planned_import_id=target_import.id where id=target_month.id;
 else old_import_id:=target_month.current_execution_import_id; update public.flight_schedule_months set current_execution_import_id=target_import.id where id=target_month.id; end if;
 if old_import_id is not null and old_import_id<>target_import.id then update public.flight_schedule_imports set superseded_at=now() where id=old_import_id; end if;
 insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata) values(current_user_id,target_month.id,target_import.id,case when target_import.schedule_role='PLANNED' then 'PLANNED_SCHEDULE_IMPORTED' else 'EXECUTION_SNAPSHOT_IMPORTED' end,current_user_id,jsonb_build_object('event','SCHEDULE_PROCESSING_PROMOTED','oldImportId',old_import_id));
 return jsonb_build_object('status','promoted','importId',target_import.id,'previousImportId',old_import_id);
end $$;

revoke all on function public.persist_flight_schedule_reconciliation(uuid,text,integer,integer,integer,integer,integer,text,text,text) from public,anon;
grant execute on function public.persist_flight_schedule_reconciliation(uuid,text,integer,integer,integer,integer,integer,text,text,text) to authenticated,service_role;
