begin;

alter table public.bank_connections
  add column if not exists automatic_sync_enabled boolean not null default true;

create index if not exists bank_connections_scheduled_sync_idx
  on public.bank_connections(provider, status, automatic_sync_enabled)
  where provider = 'pluggy' and status = 'active';

create table if not exists public.financial_sync_locks (
  bank_connection_id uuid primary key
    references public.bank_connections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  lock_token uuid not null,
  trigger_type text not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (trigger_type in ('scheduled','webhook','manual','retry','system'))
);

create index if not exists financial_sync_locks_workspace_integration_idx
  on public.financial_sync_locks(
    coalesce(workspace_id, owner_id),
    bank_connection_id,
    expires_at
  );

alter table public.financial_sync_locks enable row level security;
revoke all on public.financial_sync_locks from public, anon, authenticated;
grant select, insert, update, delete on public.financial_sync_locks to service_role;

create or replace function public.acquire_scheduled_pluggy_sync_lock(
  target_connection uuid,
  lock_ttl_seconds integer default 3300
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_owner uuid;
  connection_workspace uuid;
  candidate_token uuid := gen_random_uuid();
  acquired_token uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled sync access denied';
  end if;
  if lock_ttl_seconds < 60 or lock_ttl_seconds > 3600 then
    raise exception 'invalid lock ttl';
  end if;

  select owner_id, workspace_id
    into connection_owner, connection_workspace
  from public.bank_connections
  where id = target_connection
    and provider = 'pluggy'
    and status = 'active'
    and automatic_sync_enabled;

  if connection_owner is null then
    return null;
  end if;

  insert into public.financial_sync_locks(
    bank_connection_id, owner_id, workspace_id, lock_token,
    trigger_type, locked_at, expires_at
  ) values (
    target_connection, connection_owner, connection_workspace, candidate_token,
    'scheduled', now(), now() + make_interval(secs => lock_ttl_seconds)
  )
  on conflict (bank_connection_id) do update set
    owner_id = excluded.owner_id,
    workspace_id = excluded.workspace_id,
    lock_token = excluded.lock_token,
    trigger_type = excluded.trigger_type,
    locked_at = excluded.locked_at,
    expires_at = excluded.expires_at
  where public.financial_sync_locks.expires_at <= now()
  returning lock_token into acquired_token;

  return acquired_token;
end
$$;

create or replace function public.release_scheduled_pluggy_sync_lock(
  target_connection uuid,
  target_token uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'scheduled sync access denied';
  end if;
  delete from public.financial_sync_locks
  where bank_connection_id = target_connection
    and lock_token = target_token;
end
$$;

revoke all on function public.acquire_scheduled_pluggy_sync_lock(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.release_scheduled_pluggy_sync_lock(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_scheduled_pluggy_sync_lock(uuid,integer)
  to service_role;
grant execute on function public.release_scheduled_pluggy_sync_lock(uuid,uuid)
  to service_role;

create or replace function public.can_edit_workspace(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role' or exists(
    select 1 from public.workspace_members
    where workspace_id = target_workspace
      and user_id = auth.uid()
      and status = 'active'
      and role in ('owner','admin','editor')
  )
$$;

create or replace function public.can_write_finance(
  owner uuid,
  ws uuid,
  vis text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.role() = 'service_role'
    or owner = auth.uid()
    or (
      vis = 'workspace'
      and ws is not null
      and public.can_edit_workspace(ws)
    )
$$;

grant execute on function public.can_edit_workspace(uuid) to authenticated, service_role;
grant execute on function public.can_write_finance(uuid,uuid,text)
  to authenticated, service_role;

create or replace function public.validate_financial_transaction_accounts()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_owner uuid;
  account_workspace uuid;
  account_visibility text;
  loan_owner uuid;
  privileged boolean := auth.role() = 'service_role';
begin
  if not privileged and new.owner_id <> auth.uid() then
    raise exception 'invalid transaction owner';
  end if;

  if new.account_id is not null then
    select owner_id, workspace_id, visibility
      into account_owner, account_workspace, account_visibility
    from public.financial_accounts where id = new.account_id;
    if account_owner is null
      or account_owner <> new.owner_id
      or not public.can_write_finance(
        account_owner, account_workspace, account_visibility
      ) then
      raise exception 'account access denied';
    end if;
  elsif new.loan_id is not null then
    select owner_id into loan_owner
    from public.financial_loans where id = new.loan_id;
    if loan_owner is null
      or loan_owner <> new.owner_id
      or (not privileged and loan_owner <> auth.uid()) then
      raise exception 'loan access denied';
    end if;
    if new.payment_source = 'payroll' and new.account_id is not null then
      raise exception 'payroll transaction cannot affect bank account';
    end if;
  else
    raise exception 'financial target required';
  end if;

  if new.destination_account_id is not null then
    select owner_id, workspace_id, visibility
      into account_owner, account_workspace, account_visibility
    from public.financial_accounts where id = new.destination_account_id;
    if account_owner is null
      or account_owner <> new.owner_id
      or not public.can_write_finance(
        account_owner, account_workspace, account_visibility
      ) then
      raise exception 'destination account access denied';
    end if;
  end if;
  return new;
end
$$;

create or replace function public.validate_owned_credit_card_reference()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (auth.role() <> 'service_role' and new.owner_id <> auth.uid())
    or not exists (
      select 1 from public.credit_cards
      where id = new.card_id and owner_id = new.owner_id
    ) then
    raise exception 'credit card access denied';
  end if;
  return new;
end
$$;

create or replace function public.record_financial_resource_sync(
  target_run uuid,
  target_resource text,
  target_entity_type text default null,
  target_provider_entity_id text default '*',
  target_local_entity_id uuid default null,
  target_status text default 'succeeded',
  target_freshness text default 'current',
  target_completeness text default 'complete',
  target_counts jsonb default '{}',
  target_error_code text default null,
  target_error_message text default null,
  target_warning_codes text[] default '{}',
  target_retryable boolean default false,
  target_metadata jsonb default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_owner uuid;
  connection_id uuid;
  connection_workspace uuid;
  prior_success timestamptz;
  prior_retry_count integer;
  entity_key text := coalesce(nullif(target_provider_entity_id,''),'*');
begin
  select r.owner_id, r.bank_connection_id, c.workspace_id
    into run_owner, connection_id, connection_workspace
  from public.financial_sync_runs r
  join public.bank_connections c on c.id = r.bank_connection_id
  where r.id = target_run and r.status = 'running';
  if run_owner is null
    or (auth.role() <> 'service_role' and run_owner <> auth.uid()) then
    raise exception 'sync run access denied';
  end if;

  select s.last_successful_sync_at, s.retry_count
    into prior_success, prior_retry_count
  from public.financial_resource_sync_status s
  where s.bank_connection_id = connection_id
    and s.resource_type = target_resource
    and s.provider_entity_id = entity_key
  order by s.created_at desc limit 1;

  insert into public.financial_resource_sync_status(
    owner_id, workspace_id, bank_connection_id, sync_run_id,
    resource_type, entity_type, provider_entity_id, local_entity_id,
    status, sync_completeness, data_freshness, finished_at, last_attempt_at,
    last_successful_sync_at, last_data_received_at,
    records_received, records_inserted, records_updated, records_unchanged,
    records_preserved, records_skipped, records_failed, error_code,
    error_message_safe, warning_codes, retry_count, next_retry_at,
    retryable, metadata
  ) values (
    run_owner, connection_workspace, connection_id, target_run,
    target_resource, target_entity_type, entity_key, target_local_entity_id,
    target_status, target_completeness, target_freshness, now(), now(),
    case when target_status in ('succeeded','succeeded_with_warnings')
      then now() else prior_success end,
    case when coalesce((target_counts->>'received')::int,0) > 0
      then now() else null end,
    coalesce((target_counts->>'received')::int,0),
    coalesce((target_counts->>'inserted')::int,0),
    coalesce((target_counts->>'updated')::int,0),
    coalesce((target_counts->>'unchanged')::int,0),
    coalesce((target_counts->>'preserved')::int,0),
    coalesce((target_counts->>'skipped')::int,0),
    coalesce((target_counts->>'failed')::int,0),
    target_error_code, left(target_error_message,300),
    coalesce(target_warning_codes,'{}'),
    case when target_status in ('failed','unavailable','preserved')
      then coalesce(prior_retry_count,0)+1 else 0 end,
    case when target_retryable then now()+interval '15 minutes' else null end,
    target_retryable, coalesce(target_metadata,'{}')
  )
  on conflict(sync_run_id,resource_type,provider_entity_id) do update set
    status = excluded.status,
    sync_completeness = excluded.sync_completeness,
    data_freshness = excluded.data_freshness,
    finished_at = excluded.finished_at,
    last_attempt_at = excluded.last_attempt_at,
    last_successful_sync_at = excluded.last_successful_sync_at,
    last_data_received_at = excluded.last_data_received_at,
    records_received = excluded.records_received,
    records_inserted = excluded.records_inserted,
    records_updated = excluded.records_updated,
    records_unchanged = excluded.records_unchanged,
    records_preserved = excluded.records_preserved,
    records_skipped = excluded.records_skipped,
    records_failed = excluded.records_failed,
    error_code = excluded.error_code,
    error_message_safe = excluded.error_message_safe,
    warning_codes = excluded.warning_codes,
    retry_count = excluded.retry_count,
    next_retry_at = excluded.next_retry_at,
    retryable = excluded.retryable,
    metadata = excluded.metadata,
    updated_at = now();
end
$$;

create or replace function public.begin_financial_sync_v2(
  target_connection uuid,
  full_sync boolean default false,
  target_trigger text default 'manual'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_owner uuid;
  current_status text;
  connection_state text;
  started timestamptz;
  run_id uuid;
begin
  if target_trigger not in (
    'manual','full_resync','webhook','scheduled','retry','system'
  ) then
    raise exception 'invalid sync trigger';
  end if;
  select owner_id, sync_status, status, last_sync_started_at
    into connection_owner, current_status, connection_state, started
  from public.bank_connections
  where id = target_connection
  for update;
  if connection_owner is null
    or (auth.role() <> 'service_role' and connection_owner <> auth.uid()) then
    raise exception 'connection access denied';
  end if;
  if connection_state = 'disabled' then
    raise exception 'connection disabled';
  end if;
  if current_status = 'running'
    and started > now() - interval '30 minutes' then
    raise exception 'sync_in_progress';
  end if;

  update public.financial_sync_runs
  set status = 'failed',
    error_code = 'stale_run',
    error_message = 'A execução anterior excedeu o tempo limite.',
    completed_at = now()
  where bank_connection_id = target_connection and status = 'running';

  insert into public.financial_sync_runs(
    owner_id, bank_connection_id, mode, trigger_type, status
  ) values (
    connection_owner, target_connection,
    case when full_sync then 'full' else 'incremental' end,
    target_trigger, 'running'
  ) returning id into run_id;

  update public.bank_connections
  set sync_status = 'running',
    last_sync_started_at = now(),
    connection_error_code = null,
    connection_error_message = null,
    updated_at = now()
  where id = target_connection;
  return run_id;
end
$$;

create or replace function public.finish_financial_sync(
  target_run uuid,
  final_status text,
  counters jsonb default '{}'::jsonb,
  failure_code text default null,
  failure_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_id uuid;
  run_owner uuid;
begin
  select owner_id, bank_connection_id into run_owner, connection_id
  from public.financial_sync_runs
  where id = target_run and status = 'running'
  for update;
  if run_owner is null
    or (auth.role() <> 'service_role' and run_owner <> auth.uid()) then
    raise exception 'sync run access denied';
  end if;
  if final_status not in ('completed','completed_with_warnings','failed') then
    raise exception 'invalid sync status';
  end if;

  update public.financial_sync_runs set
    status = final_status,
    data_completeness = case
      when final_status = 'completed' then 'complete'
      when final_status = 'completed_with_warnings' then 'partial'
      else 'unknown'
    end,
    provider_item_status = counters->>'providerItemStatus',
    accounts_count = coalesce((counters->>'accounts')::int,0),
    cards_count = coalesce((counters->>'cards')::int,0),
    transactions_count = coalesce((counters->>'transactions')::int,0),
    investments_count = coalesce((counters->>'investments')::int,0),
    loans_count = coalesce((counters->>'loans')::int,0),
    pages_count = coalesce((counters->>'pages')::int,0),
    accounts_created = coalesce((counters->>'accountsCreated')::int,0),
    accounts_updated = coalesce((counters->>'accountsUpdated')::int,0),
    cards_created = coalesce((counters->>'cardsCreated')::int,0),
    cards_updated = coalesce((counters->>'cardsUpdated')::int,0),
    transactions_created =
      coalesce((counters->>'transactionsCreated')::int,0),
    transactions_updated =
      coalesce((counters->>'transactionsUpdated')::int,0),
    transactions_skipped =
      coalesce((counters->>'transactionsSkipped')::int,0),
    investments_created =
      coalesce((counters->>'investmentsCreated')::int,0),
    investments_updated =
      coalesce((counters->>'investmentsUpdated')::int,0),
    loans_created = coalesce((counters->>'loansCreated')::int,0),
    loans_updated = coalesce((counters->>'loansUpdated')::int,0),
    resources_total = coalesce((counters->>'resourcesTotal')::int,0),
    resources_succeeded =
      coalesce((counters->>'resourcesSucceeded')::int,0),
    resources_failed = coalesce((counters->>'resourcesFailed')::int,0),
    resources_preserved =
      coalesce((counters->>'resourcesPreserved')::int,0),
    records_inserted = coalesce((counters->>'recordsInserted')::int,0),
    records_updated = coalesce((counters->>'recordsUpdated')::int,0),
    records_unchanged = coalesce((counters->>'recordsUnchanged')::int,0),
    records_preserved = coalesce((counters->>'recordsPreserved')::int,0),
    records_skipped = coalesce((counters->>'recordsSkipped')::int,0),
    warning_codes = coalesce(
      array(
        select jsonb_array_elements_text(
          coalesce(counters->'warningCodes','[]')
        )
      ),
      '{}'
    ),
    error_code = failure_code,
    error_message = failure_message,
    completed_at = now()
  where id = target_run;

  update public.bank_connections set
    sync_status = final_status,
    last_sync_at = now(),
    last_sync_completed_at = now(),
    last_successful_sync_at = case
      when final_status in ('completed','completed_with_warnings') then now()
      else last_successful_sync_at
    end,
    last_complete_sync_at = case
      when final_status = 'completed' then now()
      else last_complete_sync_at
    end,
    provider_sync_state = case
      when final_status = 'completed' then 'success'
      when final_status = 'completed_with_warnings' then 'partial'
      else 'error'
    end,
    status = case when final_status = 'failed' then 'error' else 'active' end,
    connection_error_code = failure_code,
    connection_error_message = failure_message,
    updated_at = now()
  where id = connection_id;
end
$$;

grant execute on function public.record_financial_resource_sync(
  uuid,text,text,text,uuid,text,text,text,jsonb,text,text,text[],boolean,jsonb
) to service_role;
grant execute on function public.begin_financial_sync_v2(uuid,boolean,text)
  to service_role;
grant execute on function public.finish_financial_sync(
  uuid,text,jsonb,text,text
) to service_role;

commit;
