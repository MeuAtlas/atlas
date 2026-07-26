alter table public.bank_connections
  add column if not exists last_complete_sync_at timestamptz,
  add column if not exists provider_status text not null default 'waiting'
    check (provider_status in ('available','degraded','unavailable','waiting')),
  add column if not exists data_completeness text not null default 'unknown'
    check (data_completeness in ('complete','partial','unknown')),
  add column if not exists incident_message text,
  add column if not exists stale_since timestamptz,
  add column if not exists last_complete_counts jsonb not null default '{}'::jsonb,
  add column if not exists partial_data_count integer not null default 0
    check (partial_data_count >= 0);

alter table public.financial_sync_runs
  add column if not exists data_completeness text not null default 'unknown'
    check (data_completeness in ('complete','partial','unknown'));

alter table public.bank_connections
  drop constraint if exists bank_connections_sync_status_check;
alter table public.bank_connections
  add constraint bank_connections_sync_status_check
    check (sync_status in ('idle','running','completed','completed_with_warnings','warning','failed','unlinked'));

create or replace function public.finish_financial_sync(
  target_run uuid,
  final_status text,
  counters jsonb default '{}'::jsonb,
  failure_code text default null,
  failure_message text default null
)
returns void language plpgsql security definer set search_path=''
as $$
declare connection_id uuid; run_owner uuid;
begin
  select owner_id,bank_connection_id into run_owner,connection_id
  from public.financial_sync_runs where id=target_run and status='running' for update;
  if run_owner is null or run_owner<>auth.uid() then raise exception 'sync run access denied'; end if;
  if final_status not in ('completed','completed_with_warnings','failed') then raise exception 'invalid sync status'; end if;

  update public.financial_sync_runs set
    status=final_status,
    data_completeness=case when final_status='completed' then 'complete' when final_status='completed_with_warnings' then 'partial' else 'unknown' end,
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
    error_code=failure_code,error_message=failure_message,completed_at=now()
  where id=target_run;

  update public.bank_connections set
    sync_status=final_status,
    last_sync_at=now(),
    last_sync_completed_at=now(),
    last_successful_sync_at=case when final_status in ('completed','completed_with_warnings') then now() else last_successful_sync_at end,
    last_complete_sync_at=case when final_status='completed' then now() else last_complete_sync_at end,
    provider_status=case when final_status='completed' then 'available' when final_status='completed_with_warnings' then 'degraded' else 'unavailable' end,
    data_completeness=case when final_status='completed' then 'complete' when final_status='completed_with_warnings' then 'partial' else data_completeness end,
    stale_since=case when final_status='completed' then null else coalesce(stale_since,now()) end,
    incident_message=case when final_status='completed' then null else failure_message end,
    last_complete_counts=case when final_status='completed' then counters else last_complete_counts end,
    status=case when final_status='failed' then 'error' else 'active' end,
    connection_error_code=failure_code,
    connection_error_message=failure_message,
    updated_at=now()
  where id=connection_id;
end
$$;
