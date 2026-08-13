alter table public.flight_schedule_audit_logs
  drop constraint if exists flight_schedule_audit_logs_action_check;
alter table public.flight_schedule_audit_logs
  add constraint flight_schedule_audit_logs_action_check check(action in (
    'SCHEDULE_MONTH_CREATED', 'PLANNED_SCHEDULE_IMPORTED',
    'EXECUTION_SNAPSHOT_IMPORTED', 'EXECUTION_SNAPSHOT_DELETED',
    'EXECUTION_SNAPSHOT_PROMOTED_TO_FINAL', 'SCHEDULE_MONTH_CLOSED'
  ));

create or replace function public.delete_flight_schedule_snapshot(p_import_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  current_user_id uuid := auth.uid();
  target_import public.flight_schedule_imports;
  target_month public.flight_schedule_months;
  replacement_import_id uuid;
begin
  if current_user_id is null then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select * into target_import from public.flight_schedule_imports
  where id=p_import_id and user_id=current_user_id;
  if target_import.id is null then raise exception 'Importação não encontrada.' using errcode='P0002'; end if;
  if target_import.schedule_role <> 'EXECUTION_SNAPSHOT' then
    raise exception 'A escala planejada é uma baseline imutável e não pode ser excluída por este fluxo.' using errcode='22023';
  end if;
  select * into target_month from public.flight_schedule_months
  where id=target_import.schedule_month_id and user_id=current_user_id for update;
  if target_month.status <> 'OPEN' then raise exception 'Não é possível excluir snapshots de um mês fechado.' using errcode='22023'; end if;
  if target_month.final_execution_import_id=target_import.id then raise exception 'Não é possível excluir a escala executada final.' using errcode='22023'; end if;

  select id into replacement_import_id from public.flight_schedule_imports
  where schedule_month_id=target_month.id and schedule_role='EXECUTION_SNAPSHOT' and id<>target_import.id
  order by snapshot_number desc limit 1;
  if target_month.current_execution_import_id=target_import.id then
    update public.flight_schedule_months set current_execution_import_id=replacement_import_id where id=target_month.id;
  end if;
  delete from public.flight_schedule_imports where id=target_import.id;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,action,performed_by,metadata)
  values(current_user_id,target_month.id,'EXECUTION_SNAPSHOT_DELETED',current_user_id,jsonb_build_object(
    'deletedImportId',target_import.id, 'snapshotNumber',target_import.snapshot_number,
    'storagePath',target_import.storage_path, 'filename',target_import.original_filename
  ));
  return jsonb_build_object('storageBucket',target_import.storage_bucket,'storagePath',target_import.storage_path);
end $$;

revoke all on function public.delete_flight_schedule_snapshot(uuid) from public,anon;
grant execute on function public.delete_flight_schedule_snapshot(uuid) to authenticated;
