begin;

create or replace function public.update_financial_sync_run_provider_status(
  target_run uuid,
  target_trigger text,
  target_item_status text,
  target_execution_status text,
  target_status_detail jsonb,
  target_product_statuses jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_owner uuid;
begin
  select owner_id into run_owner
  from public.financial_sync_runs
  where id = target_run and status = 'running';
  if run_owner is null
    or (auth.role() <> 'service_role' and run_owner <> auth.uid()) then
    raise exception 'sync run access denied';
  end if;
  if target_trigger not in (
    'manual','full_resync','webhook','scheduled','retry','system','recovery',
    'webhook_item_updated','webhook_transactions_created',
    'webhook_transactions_updated','webhook_transactions_deleted'
  ) then
    raise exception 'invalid sync trigger';
  end if;
  update public.financial_sync_runs set
    trigger_type = target_trigger,
    item_status = left(target_item_status, 80),
    execution_status = left(target_execution_status, 80),
    raw_status_detail = target_status_detail,
    provider_product_statuses = coalesce(target_product_statuses, '[]'::jsonb)
  where id = target_run;
end
$$;

revoke all on function public.update_financial_sync_run_provider_status(
  uuid,text,text,text,jsonb,jsonb
) from public, anon;
grant execute on function public.update_financial_sync_run_provider_status(
  uuid,text,text,text,jsonb,jsonb
) to authenticated, service_role;

create or replace function public.record_pluggy_sync_deleted_count(
  target_run uuid,
  target_deleted integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare run_owner uuid;
begin
  select owner_id into run_owner from public.financial_sync_runs
  where id = target_run and status = 'running';
  if run_owner is null
    or (auth.role() <> 'service_role' and run_owner <> auth.uid()) then
    raise exception 'sync run access denied';
  end if;
  update public.financial_sync_runs
  set transactions_deleted = greatest(0, target_deleted)
  where id = target_run;
end
$$;

revoke all on function public.record_pluggy_sync_deleted_count(uuid,integer)
  from public, anon;
grant execute on function public.record_pluggy_sync_deleted_count(uuid,integer)
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
