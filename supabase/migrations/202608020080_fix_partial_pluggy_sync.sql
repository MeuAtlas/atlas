begin;

-- Product/account freshness must not inherit the connection-level timestamp.
alter table public.financial_accounts
  add column if not exists last_accounts_sync_at timestamptz,
  add column if not exists last_transactions_sync_at timestamptz,
  add column if not exists last_balance_sync_at timestamptz,
  add column if not exists last_remote_updated_at timestamptz,
  add column if not exists last_transaction_date date,
  add column if not exists provider_sync_warning_code text,
  add column if not exists provider_sync_warning_message text,
  add column if not exists provider_sync_error_count integer not null default 0,
  add column if not exists provider_sync_cursor jsonb not null default '{}'::jsonb;

-- Provider deletions are explicit and reversible; manual rows are never touched.
alter table public.financial_transactions
  add column if not exists provider_updated_at timestamptz,
  add column if not exists provider_synced_at timestamptz,
  add column if not exists is_provider_deleted boolean not null default false,
  add column if not exists provider_deleted_at timestamptz;

alter table public.card_purchases
  add column if not exists is_provider_deleted boolean not null default false,
  add column if not exists provider_deleted_at timestamptz;

create index if not exists financial_transactions_provider_active_idx
  on public.financial_transactions(bank_connection_id, account_id, competence_date desc)
  where source = 'pluggy' and not is_provider_deleted;

-- financial_sync_runs is the canonical execution audit. Extend it instead of
-- introducing a second orchestration table.
alter table public.financial_sync_runs
  add column if not exists item_status text,
  add column if not exists execution_status text,
  add column if not exists raw_status_detail jsonb,
  add column if not exists provider_product_statuses jsonb not null default '[]'::jsonb,
  add column if not exists transactions_deleted integer not null default 0;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid = 'public.financial_sync_runs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%trigger_type%'
  loop
    execute format('alter table public.financial_sync_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.financial_sync_runs
  add constraint financial_sync_runs_trigger_type_check check(trigger_type in (
    'manual','full_resync','webhook','scheduled','retry','system','recovery',
    'webhook_item_updated','webhook_transactions_created',
    'webhook_transactions_updated','webhook_transactions_deleted'
  ));

create or replace function public.mark_pluggy_transactions_deleted(
  target_connection uuid,
  target_account text,
  target_transaction_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection_owner uuid;
  affected integer := 0;
  changed integer := 0;
begin
  select owner_id into connection_owner
  from public.bank_connections
  where id = target_connection and provider = 'pluggy' and status <> 'disabled';
  if connection_owner is null
    or (auth.role() <> 'service_role' and connection_owner <> auth.uid()) then
    raise exception 'connection access denied';
  end if;
  if cardinality(target_transaction_ids) > 500 then
    raise exception 'too many transaction ids';
  end if;

  update public.financial_transactions
  set is_provider_deleted = true, provider_deleted_at = now(), status = 'cancelled'
  where owner_id = connection_owner
    and bank_connection_id = target_connection
    and source = 'pluggy'
    and provider_account_id = target_account
    and external_id = any(target_transaction_ids)
    and not is_provider_deleted;
  get diagnostics changed = row_count;
  affected := affected + changed;

  update public.card_purchases
  set is_provider_deleted = true, provider_deleted_at = now(), status = 'cancelled'
  where owner_id = connection_owner
    and bank_connection_id = target_connection
    and source = 'pluggy'
    and external_id = any(target_transaction_ids)
    and not is_provider_deleted;
  get diagnostics changed = row_count;
  affected := affected + changed;
  return affected;
end
$$;

revoke all on function public.mark_pluggy_transactions_deleted(uuid,text,text[])
  from public, anon;
grant execute on function public.mark_pluggy_transactions_deleted(uuid,text,text[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
