-- Pluggy integration: provider identifiers only. Bank credentials never reach Atlas.
alter table public.bank_connections
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists connector_name text,
  add column if not exists connection_error_code text,
  add column if not exists connection_error_message text,
  add column if not exists last_provider_update_at timestamptz,
  add column if not exists last_sync_started_at timestamptz,
  add column if not exists last_sync_completed_at timestamptz,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists sync_status text not null default 'idle'
    check (sync_status in ('idle','running','completed','warning','failed','unlinked')),
  add column if not exists sync_cursor jsonb not null default '{}'::jsonb;

create unique index if not exists bank_connections_provider_item_unique
  on public.bank_connections(provider, provider_connection_id);

alter table public.financial_accounts
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists provider_status text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
create unique index if not exists financial_accounts_import_unique
  on public.financial_accounts(owner_id, source, external_id);

alter table public.credit_cards
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists used_limit numeric(15,2) not null default 0,
  add column if not exists current_balance numeric(15,2) not null default 0,
  add column if not exists provider_status text,
  add column if not exists last_sync_at timestamptz,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
create unique index if not exists credit_cards_import_unique
  on public.credit_cards(owner_id, source, external_id);

alter table public.financial_transactions alter column account_id drop not null;
do $$ declare constraint_name text; begin
 for constraint_name in
  select conname from pg_constraint where conrelid='public.financial_transactions'::regclass and contype='c'
  and pg_get_constraintdef(oid) ilike '%destination_account_id%' and pg_get_constraintdef(oid) ilike '%transaction_type%'
 loop execute format('alter table public.financial_transactions drop constraint %I',constraint_name); end loop;
end $$;
alter table public.financial_transactions
  add column if not exists bank_connection_id uuid references public.bank_connections(id) on delete set null,
  add column if not exists credit_card_id uuid references public.credit_cards(id) on delete set null,
  add column if not exists provider_category text,
  add column if not exists original_currency char(3),
  add column if not exists original_amount numeric(15,2),
  add column if not exists merchant text,
  add column if not exists review_status text not null default 'reviewed' check(review_status in ('pending','reviewed','ignored')),
  add column if not exists suspected_transfer boolean not null default false,
  add column if not exists cash_flow_kind text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;
drop index if exists public.financial_transactions_import_unique;
create unique index financial_transactions_import_unique
  on public.financial_transactions(owner_id, source, external_id);
alter table public.financial_transactions drop constraint if exists financial_transactions_target_check;
alter table public.financial_transactions add constraint financial_transactions_target_check
  check(account_id is not null or credit_card_id is not null);

create table if not exists public.financial_investments (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid references public.workspaces(id) on delete set null, bank_connection_id uuid references public.bank_connections(id) on delete set null,
 source text not null default 'pluggy', external_id text not null, name text not null, investment_type text not null,
 institution_name text, currency char(3) not null default 'BRL', balance numeric(15,2) not null default 0,
 quantity numeric(20,8) not null default 0, unit_value numeric(20,8) not null default 0, amount numeric(15,2), rate numeric(12,6), subtype text, issuer text, provider_code text, due_date date, status text,
 visibility text not null default 'private' check(visibility in ('private','workspace')), provider_metadata jsonb not null default '{}'::jsonb,
 provider_updated_at timestamptz, last_sync_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,source,external_id), check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null))
);

create table if not exists public.financial_loans (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid references public.workspaces(id) on delete set null, bank_connection_id uuid references public.bank_connections(id) on delete set null,
 source text not null default 'pluggy', external_id text not null, name text not null, loan_type text not null, contract_number text,
 institution_name text, currency char(3) not null default 'BRL', original_amount numeric(15,2) not null default 0, balance_due numeric(15,2) not null default 0,
 interest_rate numeric(12,6) not null default 0, installments integer, next_installment_amount numeric(15,2), next_installment_date date, start_date date, end_date date, status text,
 visibility text not null default 'private' check(visibility in ('private','workspace')), provider_metadata jsonb not null default '{}'::jsonb,
 last_sync_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,source,external_id), check((visibility='private' and workspace_id is null) or (visibility='workspace' and workspace_id is not null))
);

create table if not exists public.financial_sync_runs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 bank_connection_id uuid not null references public.bank_connections(id) on delete cascade,
 provider text not null default 'pluggy', mode text not null check(mode in ('incremental','full')), status text not null check(status in ('pending','running','completed','completed_with_warnings','failed')),
 accounts_count integer not null default 0, cards_count integer not null default 0, transactions_count integer not null default 0,
 investments_count integer not null default 0, loans_count integer not null default 0, pages_count integer not null default 0,
 accounts_created integer not null default 0, accounts_updated integer not null default 0, cards_created integer not null default 0, cards_updated integer not null default 0,
 transactions_created integer not null default 0, transactions_updated integer not null default 0, transactions_skipped integer not null default 0,
 investments_created integer not null default 0, investments_updated integer not null default 0, loans_created integer not null default 0, loans_updated integer not null default 0,
 error_code text, error_message text, metadata jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), completed_at timestamptz,
 created_at timestamptz not null default now()
);

alter table public.financial_investments enable row level security;
alter table public.financial_loans enable row level security;
alter table public.financial_sync_runs enable row level security;
create policy investments_owner on public.financial_investments for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy loans_owner on public.financial_loans for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy sync_runs_read on public.financial_sync_runs for select to authenticated using(owner_id=auth.uid());

create or replace function public.begin_financial_sync(target_connection uuid, full_sync boolean default false)
returns uuid language plpgsql security definer set search_path=''
as $$ declare connection_owner uuid; current_status text; connection_state text; started timestamptz; run_id uuid;
begin
 select owner_id,sync_status,status,last_sync_started_at into connection_owner,current_status,connection_state,started from public.bank_connections where id=target_connection for update;
 if connection_owner is null or connection_owner<>auth.uid() then raise exception 'connection access denied'; end if;
 if connection_state='disabled' then raise exception 'connection disabled'; end if;
 if current_status='running' and started>now()-interval '30 minutes' then raise exception 'sync_in_progress'; end if;
 update public.financial_sync_runs set status='failed',error_code='stale_run',error_message='A execução anterior excedeu o tempo limite.',completed_at=now() where bank_connection_id=target_connection and status='running';
 insert into public.financial_sync_runs(owner_id,bank_connection_id,mode,status) values(connection_owner,target_connection,case when full_sync then 'full' else 'incremental' end,'running') returning id into run_id;
 update public.bank_connections set sync_status='running',last_sync_started_at=now(),connection_error_code=null,connection_error_message=null,updated_at=now() where id=target_connection;
 return run_id;
end $$;

create or replace function public.unlink_financial_connection(target_connection uuid)
returns void language plpgsql security definer set search_path=''
as $$ declare connection_owner uuid; current_status text; started timestamptz;
begin
 select owner_id,sync_status,last_sync_started_at into connection_owner,current_status,started from public.bank_connections where id=target_connection for update;
 if connection_owner is null or connection_owner<>auth.uid() then raise exception 'connection access denied'; end if;
 if current_status='running' and started>now()-interval '30 minutes' then raise exception 'sync_in_progress'; end if;
 update public.bank_connections set status='disabled',sync_status='unlinked',updated_at=now() where id=target_connection;
end $$;

create or replace function public.finish_financial_sync(target_run uuid, final_status text, counters jsonb default '{}'::jsonb, failure_code text default null, failure_message text default null)
returns void language plpgsql security definer set search_path=''
as $$ declare connection_id uuid; run_owner uuid;
begin
 select owner_id,bank_connection_id into run_owner,connection_id from public.financial_sync_runs where id=target_run and status='running' for update;
 if run_owner is null or run_owner<>auth.uid() then raise exception 'sync run access denied'; end if;
 if final_status not in ('completed','completed_with_warnings','failed') then raise exception 'invalid sync status'; end if;
 update public.financial_sync_runs set status=final_status,accounts_count=coalesce((counters->>'accounts')::int,0),cards_count=coalesce((counters->>'cards')::int,0),transactions_count=coalesce((counters->>'transactions')::int,0),investments_count=coalesce((counters->>'investments')::int,0),loans_count=coalesce((counters->>'loans')::int,0),pages_count=coalesce((counters->>'pages')::int,0),accounts_created=coalesce((counters->>'accountsCreated')::int,0),accounts_updated=coalesce((counters->>'accountsUpdated')::int,0),cards_created=coalesce((counters->>'cardsCreated')::int,0),cards_updated=coalesce((counters->>'cardsUpdated')::int,0),transactions_created=coalesce((counters->>'transactionsCreated')::int,0),transactions_updated=coalesce((counters->>'transactionsUpdated')::int,0),transactions_skipped=coalesce((counters->>'transactionsSkipped')::int,0),investments_created=coalesce((counters->>'investmentsCreated')::int,0),investments_updated=coalesce((counters->>'investmentsUpdated')::int,0),loans_created=coalesce((counters->>'loansCreated')::int,0),loans_updated=coalesce((counters->>'loansUpdated')::int,0),error_code=failure_code,error_message=failure_message,completed_at=now() where id=target_run;
 update public.bank_connections set sync_status=case when final_status='completed_with_warnings' then 'warning' else final_status end,last_sync_at=now(),last_sync_completed_at=now(),last_successful_sync_at=case when final_status in ('completed','completed_with_warnings') then now() else last_successful_sync_at end,status=case when final_status='failed' then 'error' else 'active' end,connection_error_code=failure_code,connection_error_message=failure_message,updated_at=now() where id=connection_id;
end $$;

create or replace function public.validate_financial_transaction_accounts()
returns trigger language plpgsql security invoker set search_path=''
as $$ declare resource_owner uuid; resource_workspace uuid; resource_visibility text;
begin
 if new.owner_id<>auth.uid() then raise exception 'invalid transaction owner'; end if;
 if new.account_id is not null then
  select owner_id,workspace_id,visibility into resource_owner,resource_workspace,resource_visibility from public.financial_accounts where id=new.account_id;
 elsif new.credit_card_id is not null then
  select owner_id,workspace_id,visibility into resource_owner,resource_workspace,resource_visibility from public.credit_cards where id=new.credit_card_id;
 end if;
 if resource_owner is null or not public.can_write_finance(resource_owner,resource_workspace,resource_visibility) then raise exception 'financial target access denied'; end if;
 if new.destination_account_id is not null then
  select owner_id,workspace_id,visibility into resource_owner,resource_workspace,resource_visibility from public.financial_accounts where id=new.destination_account_id;
  if resource_owner is null or not public.can_write_finance(resource_owner,resource_workspace,resource_visibility) then raise exception 'destination account access denied'; end if;
 end if;
 return new;
end $$;

create or replace function public.refresh_financial_account(target uuid)
returns void language sql security definer set search_path=''
as $$ update public.financial_accounts a set current_balance=a.opening_balance+
 coalesce((select sum(case when t.account_id=target and t.transaction_type in ('income','refund','reversal') then t.amount when t.account_id=target and t.transaction_type='expense' then -t.amount when t.account_id=target and t.transaction_type='transfer' then -t.amount when t.destination_account_id=target and t.transaction_type='transfer' then t.amount else 0 end) from public.financial_transactions t where t.status='realized' and (t.account_id=target or t.destination_account_id=target)),0), balance_updated_at=now()
 where a.id=target and a.source<>'pluggy' $$;

grant select,insert,update,delete on public.financial_investments,public.financial_loans to authenticated;
grant select on public.financial_sync_runs to authenticated;
revoke all on function public.begin_financial_sync(uuid,boolean), public.finish_financial_sync(uuid,text,jsonb,text,text), public.unlink_financial_connection(uuid) from public, anon;
grant execute on function public.begin_financial_sync(uuid,boolean), public.finish_financial_sync(uuid,text,jsonb,text,text), public.unlink_financial_connection(uuid) to authenticated;
