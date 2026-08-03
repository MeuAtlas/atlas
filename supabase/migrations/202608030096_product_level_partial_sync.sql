begin;

-- financial_sync_runs and financial_resource_sync_status remain the canonical
-- execution and per-product audit tables. Connection timestamps are split so
-- an attempt can never masquerade as a successful data update.
alter table public.bank_connections
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_any_success_at timestamptz,
  add column if not exists last_integral_success_at timestamptz,
  add column if not exists connection_sync_status text not null default 'needs_attention';

alter table public.bank_connections
  drop constraint if exists bank_connections_connection_sync_status_check;
alter table public.bank_connections
  add constraint bank_connections_connection_sync_status_check check (
    connection_sync_status in (
      'updated','partially_updated','updated_with_warnings',
      'needs_attention','error','syncing'
    )
  );

update public.bank_connections connection
set
  last_sync_attempt_at = coalesce(
    connection.last_sync_started_at,
    connection.last_sync_completed_at,
    connection.last_sync_at
  ),
  last_any_success_at = coalesce(
    (
      select max(resource.last_successful_sync_at)
      from public.financial_resource_sync_status resource
      where resource.bank_connection_id = connection.id
        and resource.resource_type in (
          'accounts','transactions','credit_cards','bills','loans','investments'
        )
    ),
    connection.last_successful_sync_at
  ),
  last_integral_success_at = coalesce(
    connection.last_complete_sync_at,
    case when connection.data_completeness = 'complete'
      then connection.last_successful_sync_at end
  ),
  connection_sync_status = case
    when connection.sync_status = 'running' then 'syncing'
    when connection.status = 'error' then 'error'
    when connection.data_completeness = 'complete' then 'updated'
    when connection.data_completeness = 'partial' then 'partially_updated'
    else 'needs_attention'
  end;

-- A partial page with valid rows is a successful product update, although it
-- is not an integral snapshot. Preserved/failed products retain prior success.
create or replace function public.preserve_partial_resource_success_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not (
    new.status = 'succeeded'
    or (
      new.status = 'succeeded_with_warnings'
      and new.records_received > 0
    )
  ) then
    select prior.last_successful_sync_at into new.last_successful_sync_at
    from public.financial_resource_sync_status prior
    where prior.bank_connection_id = new.bank_connection_id
      and prior.resource_type = new.resource_type
      and prior.provider_entity_id = new.provider_entity_id
      and prior.id <> new.id
      and (
        prior.status = 'succeeded'
        or (
          prior.status = 'succeeded_with_warnings'
          and prior.records_received > 0
        )
      )
    order by prior.created_at desc
    limit 1;
  end if;
  return new;
end
$$;

drop trigger if exists preserve_partial_resource_success_timestamp
  on public.financial_resource_sync_status;
create trigger preserve_partial_resource_success_timestamp
before insert or update of status, sync_completeness, last_successful_sync_at,
  records_received
on public.financial_resource_sync_status
for each row execute function public.preserve_partial_resource_success_timestamp();

notify pgrst, 'reload schema';
commit;
