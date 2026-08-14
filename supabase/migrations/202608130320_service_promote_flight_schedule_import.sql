-- Server-side recovery path for imports that were parsed and persisted but whose
-- derivation failed before the user-facing promotion transaction could run.
create or replace function public.promote_flight_schedule_import_for_owner(
  p_import_id uuid,
  p_owner_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_import public.flight_schedule_imports; target_month public.flight_schedule_months; old_import_id uuid;
begin
  if p_owner_user_id is null then raise exception 'ProprietÃ¡rio da importaÃ§Ã£o ausente.' using errcode='22023'; end if;
  select * into target_import from public.flight_schedule_imports where id=p_import_id and user_id=p_owner_user_id for update;
  if not found then raise exception 'ImportaÃ§Ã£o nÃ£o encontrada.' using errcode='42501'; end if;
  if target_import.status not in ('PROCESSED','PROCESSED_WITH_WARNINGS') then raise exception 'A escala ainda nÃ£o foi processada com sucesso.' using errcode='22023'; end if;
  select * into target_month from public.flight_schedule_months where id=target_import.schedule_month_id and user_id=p_owner_user_id for update;
  if not found then raise exception 'CompetÃªncia operacional nÃ£o encontrada.' using errcode='42501'; end if;
  if target_import.document_period_start is null or extract(year from target_import.document_period_start) <> target_month.year or extract(month from target_import.document_period_start) <> target_month.month then raise exception 'Este documento pertence a outra competÃªncia.' using errcode='22023'; end if;
  if target_import.schedule_role='PLANNED' then
    old_import_id := target_month.planned_import_id;
    update public.flight_schedule_months set planned_import_id=target_import.id where id=target_month.id;
  else
    old_import_id := target_month.current_execution_import_id;
    update public.flight_schedule_months set current_execution_import_id=target_import.id where id=target_month.id;
  end if;
  if old_import_id is not null and old_import_id <> target_import.id then update public.flight_schedule_imports set superseded_at=now() where id=old_import_id; end if;
  insert into public.flight_schedule_audit_logs(user_id,schedule_month_id,import_id,action,performed_by,metadata)
  values(p_owner_user_id,target_month.id,target_import.id,case when target_import.schedule_role='PLANNED' then 'PLANNED_SCHEDULE_IMPORTED' else 'EXECUTION_SNAPSHOT_IMPORTED' end,p_owner_user_id,jsonb_build_object('event','SCHEDULE_IMPORT_RECOVERED','oldImportId',old_import_id));
  return jsonb_build_object('status','promoted','importId',target_import.id,'previousImportId',old_import_id);
end $$;

revoke all on function public.promote_flight_schedule_import_for_owner(uuid,uuid) from public,anon,authenticated;
grant execute on function public.promote_flight_schedule_import_for_owner(uuid,uuid) to service_role;
