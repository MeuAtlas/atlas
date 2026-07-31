-- Incremental Pluggy synchronization with resource/entity freshness.

alter table public.financial_sync_runs
  add column if not exists trigger_type text not null default 'manual'
    check (trigger_type in ('manual','full_resync','webhook','scheduled','retry','system')),
  add column if not exists provider_item_status text,
  add column if not exists resources_total integer not null default 0,
  add column if not exists resources_succeeded integer not null default 0,
  add column if not exists resources_failed integer not null default 0,
  add column if not exists resources_preserved integer not null default 0,
  add column if not exists records_inserted integer not null default 0,
  add column if not exists records_updated integer not null default 0,
  add column if not exists records_unchanged integer not null default 0,
  add column if not exists records_preserved integer not null default 0,
  add column if not exists records_skipped integer not null default 0,
  add column if not exists warning_codes text[] not null default '{}';

create table if not exists public.financial_resource_sync_status (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  bank_connection_id uuid not null references public.bank_connections(id) on delete cascade,
  sync_run_id uuid not null references public.financial_sync_runs(id) on delete cascade,
  item_id_hash text,
  resource_type text not null check (resource_type in (
    'accounts','transactions','credit_cards','bills','loans',
    'investments','identity','item','connector'
  )),
  entity_type text,
  provider_entity_id text not null default '*',
  local_entity_id uuid,
  status text not null check (status in (
    'pending','running','succeeded','succeeded_with_warnings',
    'failed','unavailable','preserved','skipped'
  )),
  sync_completeness text not null default 'unknown'
    check (sync_completeness in ('complete','partial','unknown')),
  data_freshness text not null default 'unknown'
    check (data_freshness in ('current','partially_current','stale','unavailable','unknown')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  last_attempt_at timestamptz not null default now(),
  last_successful_sync_at timestamptz,
  last_data_received_at timestamptz,
  records_received integer not null default 0 check (records_received >= 0),
  records_inserted integer not null default 0 check (records_inserted >= 0),
  records_updated integer not null default 0 check (records_updated >= 0),
  records_unchanged integer not null default 0 check (records_unchanged >= 0),
  records_preserved integer not null default 0 check (records_preserved >= 0),
  records_skipped integer not null default 0 check (records_skipped >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
  error_code text,
  error_message_safe text,
  warning_codes text[] not null default '{}',
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  retryable boolean not null default false,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sync_run_id,resource_type,provider_entity_id)
);

alter table public.financial_resource_sync_status enable row level security;
drop policy if exists financial_resource_sync_status_read on public.financial_resource_sync_status;
create policy financial_resource_sync_status_read
  on public.financial_resource_sync_status for select to authenticated
  using (owner_id = auth.uid());
grant select on public.financial_resource_sync_status to authenticated;

create index if not exists financial_sync_runs_workspace_started_idx
  on public.financial_sync_runs(owner_id,bank_connection_id,started_at desc);
create index if not exists financial_sync_runs_status_idx
  on public.financial_sync_runs(status,started_at desc);
create index if not exists financial_resource_sync_connection_idx
  on public.financial_resource_sync_status(bank_connection_id,resource_type,provider_entity_id,created_at desc);
create index if not exists financial_resource_sync_retry_idx
  on public.financial_resource_sync_status(status,next_retry_at)
  where retryable;
create index if not exists financial_resource_sync_success_idx
  on public.financial_resource_sync_status(bank_connection_id,resource_type,last_successful_sync_at desc);

alter table public.financial_accounts
  add column if not exists provider_last_attempt_at timestamptz,
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_data_freshness text not null default 'unknown'
    check (provider_data_freshness in ('current','partially_current','stale','unavailable','unknown')),
  add column if not exists provider_sync_status text not null default 'pending',
  add column if not exists provider_last_error_code text;

alter table public.credit_cards
  add column if not exists provider_last_attempt_at timestamptz,
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_data_freshness text not null default 'unknown'
    check (provider_data_freshness in ('current','partially_current','stale','unavailable','unknown')),
  add column if not exists provider_sync_status text not null default 'pending',
  add column if not exists provider_last_error_code text;

alter table public.financial_investments
  add column if not exists provider_last_attempt_at timestamptz,
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_data_freshness text not null default 'unknown'
    check (provider_data_freshness in ('current','partially_current','stale','unavailable','unknown')),
  add column if not exists provider_sync_status text not null default 'pending',
  add column if not exists provider_last_error_code text;

alter table public.financial_loans
  add column if not exists provider_last_attempt_at timestamptz,
  add column if not exists provider_last_success_at timestamptz,
  add column if not exists provider_data_freshness text not null default 'unknown'
    check (provider_data_freshness in ('current','partially_current','stale','unavailable','unknown')),
  add column if not exists provider_sync_status text not null default 'pending',
  add column if not exists provider_last_error_code text;

alter table public.financial_transactions
  add column if not exists provider_fingerprint text,
  add column if not exists provider_updated_at timestamptz,
  add column if not exists provider_description text,
  add column if not exists provider_status text,
  add column if not exists provider_amount numeric(15,2),
  add column if not exists provider_date date;

create index if not exists financial_transactions_provider_fingerprint_idx
  on public.financial_transactions(account_id,provider_fingerprint)
  where source = 'pluggy';

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
returns void language plpgsql security definer set search_path=''
as $$
declare
  run_owner uuid;
  connection_id uuid;
  connection_workspace uuid;
  prior_success timestamptz;
  prior_retry_count integer;
  entity_key text := coalesce(nullif(target_provider_entity_id,''),'*');
begin
  select r.owner_id,r.bank_connection_id,c.workspace_id
    into run_owner,connection_id,connection_workspace
  from public.financial_sync_runs r
  join public.bank_connections c on c.id=r.bank_connection_id
  where r.id=target_run and r.status='running';
  if run_owner is null or run_owner<>auth.uid() then
    raise exception 'sync run access denied';
  end if;

  select s.last_successful_sync_at,s.retry_count
    into prior_success,prior_retry_count
  from public.financial_resource_sync_status s
  where s.bank_connection_id=connection_id
    and s.resource_type=target_resource
    and s.provider_entity_id=entity_key
  order by s.created_at desc limit 1;

  insert into public.financial_resource_sync_status(
    owner_id,workspace_id,bank_connection_id,sync_run_id,
    resource_type,entity_type,provider_entity_id,local_entity_id,
    status,sync_completeness,data_freshness,finished_at,last_attempt_at,
    last_successful_sync_at,last_data_received_at,
    records_received,records_inserted,records_updated,records_unchanged,
    records_preserved,records_skipped,records_failed,error_code,
    error_message_safe,warning_codes,retry_count,next_retry_at,retryable,metadata
  ) values (
    run_owner,connection_workspace,connection_id,target_run,
    target_resource,target_entity_type,entity_key,target_local_entity_id,
    target_status,target_completeness,target_freshness,now(),now(),
    case when target_status in ('succeeded','succeeded_with_warnings') then now() else prior_success end,
    case when coalesce((target_counts->>'received')::int,0)>0 then now() else null end,
    coalesce((target_counts->>'received')::int,0),
    coalesce((target_counts->>'inserted')::int,0),
    coalesce((target_counts->>'updated')::int,0),
    coalesce((target_counts->>'unchanged')::int,0),
    coalesce((target_counts->>'preserved')::int,0),
    coalesce((target_counts->>'skipped')::int,0),
    coalesce((target_counts->>'failed')::int,0),
    target_error_code,left(target_error_message,300),coalesce(target_warning_codes,'{}'),
    case when target_status in ('failed','unavailable','preserved') then coalesce(prior_retry_count,0)+1 else 0 end,
    case when target_retryable then now()+interval '15 minutes' else null end,
    target_retryable,coalesce(target_metadata,'{}')
  )
  on conflict(sync_run_id,resource_type,provider_entity_id) do update set
    status=excluded.status,
    sync_completeness=excluded.sync_completeness,
    data_freshness=excluded.data_freshness,
    finished_at=excluded.finished_at,
    last_attempt_at=excluded.last_attempt_at,
    last_successful_sync_at=excluded.last_successful_sync_at,
    last_data_received_at=excluded.last_data_received_at,
    records_received=excluded.records_received,
    records_inserted=excluded.records_inserted,
    records_updated=excluded.records_updated,
    records_unchanged=excluded.records_unchanged,
    records_preserved=excluded.records_preserved,
    records_skipped=excluded.records_skipped,
    records_failed=excluded.records_failed,
    error_code=excluded.error_code,
    error_message_safe=excluded.error_message_safe,
    warning_codes=excluded.warning_codes,
    retry_count=excluded.retry_count,
    next_retry_at=excluded.next_retry_at,
    retryable=excluded.retryable,
    metadata=excluded.metadata,
    updated_at=now();
end
$$;

revoke all on function public.record_financial_resource_sync(
  uuid,text,text,text,uuid,text,text,text,jsonb,text,text,text[],boolean,jsonb
) from public,anon;
grant execute on function public.record_financial_resource_sync(
  uuid,text,text,text,uuid,text,text,text,jsonb,text,text,text[],boolean,jsonb
) to authenticated;

create or replace function public.begin_financial_sync_v2(
  target_connection uuid,
  full_sync boolean,
  target_trigger text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  connection_owner uuid;
  current_status text;
  connection_state text;
  started timestamptz;
  run_id uuid;
begin
  if target_trigger not in ('manual','full_resync','webhook','scheduled','retry','system') then
    raise exception 'invalid sync trigger';
  end if;
  select owner_id,sync_status,status,last_sync_started_at
    into connection_owner,current_status,connection_state,started
  from public.bank_connections where id=target_connection for update;
  if connection_owner is null or connection_owner<>auth.uid() then
    raise exception 'connection access denied';
  end if;
  if connection_state='disabled' then raise exception 'connection disabled'; end if;
  if current_status='running' and started>now()-interval '30 minutes' then
    raise exception 'sync_in_progress';
  end if;
  update public.financial_sync_runs
    set status='failed',error_code='stale_run',
      error_message='A execução anterior excedeu o tempo limite.',completed_at=now()
  where bank_connection_id=target_connection and status='running';
  insert into public.financial_sync_runs(
    owner_id,bank_connection_id,mode,trigger_type,status
  ) values (
    connection_owner,target_connection,
    case when full_sync then 'full' else 'incremental' end,
    target_trigger,'running'
  ) returning id into run_id;
  update public.bank_connections
    set sync_status='running',last_sync_started_at=now(),
      connection_error_code=null,connection_error_message=null,updated_at=now()
  where id=target_connection;
  return run_id;
end
$$;

revoke all on function public.begin_financial_sync_v2(uuid,boolean,text) from public,anon;
grant execute on function public.begin_financial_sync_v2(uuid,boolean,text) to authenticated;

create or replace function public.finish_financial_sync(
  target_run uuid,
  final_status text,
  counters jsonb default '{}'::jsonb,
  failure_code text default null,
  failure_message text default null
)
returns void language plpgsql security definer set search_path=''
as $$
declare
  connection_id uuid;
  run_owner uuid;
begin
  select owner_id,bank_connection_id into run_owner,connection_id
  from public.financial_sync_runs where id=target_run and status='running' for update;
  if run_owner is null or run_owner<>auth.uid() then
    raise exception 'sync run access denied';
  end if;
  if final_status not in ('completed','completed_with_warnings','failed') then
    raise exception 'invalid sync status';
  end if;

  update public.financial_sync_runs set
    status=final_status,
    data_completeness=case
      when final_status='completed' then 'complete'
      when final_status='completed_with_warnings' then 'partial'
      else 'unknown'
    end,
    provider_item_status=counters->>'providerItemStatus',
    accounts_count=coalesce((counters->>'accounts')::int,0),
    cards_count=coalesce((counters->>'cards')::int,0),
    transactions_count=coalesce((counters->>'transactions')::int,0),
    investments_count=coalesce((counters->>'investments')::int,0),
    loans_count=coalesce((counters->>'loans')::int,0),
    pages_count=coalesce((counters->>'pages')::int,0),
    accounts_created=coalesce((counters->>'accountsCreated')::int,0),
    accounts_updated=coalesce((counters->>'accountsUpdated')::int,0),
    cards_created=coalesce((counters->>'cardsCreated')::int,0),
    cards_updated=coalesce((counters->>'cardsUpdated')::int,0),
    transactions_created=coalesce((counters->>'transactionsCreated')::int,0),
    transactions_updated=coalesce((counters->>'transactionsUpdated')::int,0),
    transactions_skipped=coalesce((counters->>'transactionsSkipped')::int,0),
    investments_created=coalesce((counters->>'investmentsCreated')::int,0),
    investments_updated=coalesce((counters->>'investmentsUpdated')::int,0),
    loans_created=coalesce((counters->>'loansCreated')::int,0),
    loans_updated=coalesce((counters->>'loansUpdated')::int,0),
    resources_total=coalesce((counters->>'resourcesTotal')::int,0),
    resources_succeeded=coalesce((counters->>'resourcesSucceeded')::int,0),
    resources_failed=coalesce((counters->>'resourcesFailed')::int,0),
    resources_preserved=coalesce((counters->>'resourcesPreserved')::int,0),
    records_inserted=coalesce((counters->>'recordsInserted')::int,0),
    records_updated=coalesce((counters->>'recordsUpdated')::int,0),
    records_unchanged=coalesce((counters->>'recordsUnchanged')::int,0),
    records_preserved=coalesce((counters->>'recordsPreserved')::int,0),
    records_skipped=coalesce((counters->>'recordsSkipped')::int,0),
    warning_codes=coalesce(
      array(select jsonb_array_elements_text(coalesce(counters->'warningCodes','[]'))),
      '{}'
    ),
    error_code=failure_code,error_message=failure_message,completed_at=now()
  where id=target_run;

  update public.bank_connections set
    sync_status=final_status,
    last_sync_at=now(),
    last_sync_completed_at=now(),
    last_successful_sync_at=case
      when final_status in ('completed','completed_with_warnings') then now()
      else last_successful_sync_at
    end,
    last_complete_sync_at=case
      when final_status='completed' then now()
      else last_complete_sync_at
    end,
    provider_status=case
      when final_status='completed' then 'available'
      when final_status='completed_with_warnings' then 'degraded'
      else 'unavailable'
    end,
    data_completeness=case
      when final_status='completed' then 'complete'
      when final_status='completed_with_warnings' then 'partial'
      else data_completeness
    end,
    stale_since=case
      when final_status='completed' then null
      else coalesce(stale_since,now())
    end,
    incident_message=case when final_status='completed' then null else failure_message end,
    last_complete_counts=case when final_status='completed' then counters else last_complete_counts end,
    status=case when final_status='failed' then 'error' else 'active' end,
    connection_error_code=failure_code,
    connection_error_message=failure_message,
    updated_at=now()
  where id=connection_id;
end
$$;

notify pgrst, 'reload schema';
