begin;

create extension if not exists pgcrypto;

create table if not exists public.expense_establishments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 160),
  category_id uuid references public.financial_categories(id) on delete set null,
  reference_daily_amount numeric(15,2)
    check (reference_daily_amount is null or reference_daily_amount > 0),
  planning_enabled boolean not null default false,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, normalized_name)
);

create table if not exists public.expense_establishment_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  establishment_id uuid not null references public.expense_establishments(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  provider text,
  match_type text not null check (match_type in (
    'provider_counterparty','pix_key','tax_number','bank_account','normalized_name'
  )),
  match_hash text not null check (char_length(match_hash) = 64),
  display_name text,
  masked_identifier text,
  direction_scope text not null default 'outgoing_only'
    check (direction_scope = 'outgoing_only'),
  apply_to_history boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, match_type, match_hash)
);

create table if not exists public.expense_establishment_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  establishment_id uuid not null references public.expense_establishments(id) on delete cascade,
  transaction_id uuid not null references public.financial_transactions(id) on delete cascade,
  rule_id uuid references public.expense_establishment_rules(id) on delete set null,
  association_source text not null check (association_source in (
    'manual','historical_backfill','automatic_rule'
  )),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unlinked_at timestamptz,
  unique (transaction_id)
);

create index if not exists expense_establishments_workspace_idx
  on public.expense_establishments(workspace_id, status);
create index if not exists expense_establishment_rules_match_idx
  on public.expense_establishment_rules(workspace_id, match_type, match_hash)
  where is_active and archived_at is null;
create index if not exists expense_establishment_transactions_entity_idx
  on public.expense_establishment_transactions(workspace_id, establishment_id)
  where is_active;

create or replace function public.validate_expense_establishment_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare target_workspace uuid; transaction_owner uuid;
begin
  if tg_table_name = 'expense_establishment_rules' then
    if not public.can_edit_workspace(new.workspace_id) then
      raise exception 'expense establishment write access denied';
    end if;
    select workspace_id into target_workspace
    from public.expense_establishments
    where id = new.establishment_id and status = 'active';
  elsif tg_table_name = 'expense_establishment_transactions' then
    select workspace_id into target_workspace
    from public.expense_establishments
    where id = new.establishment_id and status = 'active';
    if target_workspace is distinct from new.workspace_id then
      raise exception 'expense establishment workspace mismatch';
    end if;
    select workspace_id, owner_id into target_workspace, transaction_owner
    from public.financial_transactions where id = new.transaction_id;
    if target_workspace is null then
      select id into target_workspace from public.workspaces
      where id = new.workspace_id and owner_id = transaction_owner;
    end if;
    if new.created_by is not null and (
      new.created_by <> auth.uid() or not public.can_edit_workspace(new.workspace_id)
    ) then
      raise exception 'expense establishment write access denied';
    end if;
  elsif not public.can_edit_workspace(new.workspace_id) then
    raise exception 'expense establishment write access denied';
  end if;
  if target_workspace is distinct from new.workspace_id then
    raise exception 'expense establishment workspace mismatch';
  end if;
  return new;
end $$;

create or replace function public.expense_establishment_transaction_hash(
  target public.financial_transactions,
  requested_type text
) returns text language sql immutable set search_path = ''
as $$
  select case requested_type
    when 'provider_counterparty' then encode(extensions.digest(
      coalesce(target.provider_metadata #>> '{counterparty,providerCounterpartyId}', ''),
      'sha256'
    ), 'hex')
    when 'pix_key' then encode(extensions.digest(
      coalesce(target.provider_metadata #>> '{counterparty,pixKeyHash}', ''),
      'sha256'
    ), 'hex')
    when 'tax_number' then encode(extensions.digest(
      coalesce(target.provider_metadata #>> '{counterparty,taxNumberHash}', ''),
      'sha256'
    ), 'hex')
    when 'bank_account' then encode(extensions.digest(
      concat_ws(':',
        target.provider_metadata #>> '{counterparty,bankCode}',
        target.provider_metadata #>> '{counterparty,accountMasked}'
      ), 'sha256'
    ), 'hex')
    when 'normalized_name' then encode(extensions.digest(
      coalesce(
        target.provider_metadata #>> '{counterparty,normalizedName}',
        lower(btrim(regexp_replace(target.description, '[^a-zA-Z0-9]+', ' ', 'g')))
      ), 'sha256'
    ), 'hex')
    else ''
  end
$$;

create or replace function public.apply_expense_establishment_rule()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  matched_rule public.expense_establishment_rules%rowtype;
  effective_workspace uuid;
begin
  if new.bank_direction <> 'outflow' or new.status in ('cancelled','disputed') then
    return new;
  end if;
  effective_workspace := new.workspace_id;
  if effective_workspace is null and new.bank_connection_id is not null then
    select workspace_id into effective_workspace from public.bank_connections
    where id = new.bank_connection_id;
  end if;
  if effective_workspace is null then
    select id into effective_workspace from public.workspaces
    where owner_id = new.owner_id order by created_at limit 1;
  end if;
  if effective_workspace is null then return new; end if;
  if exists (
    select 1 from public.expense_establishment_transactions link
    where link.transaction_id = new.id
  ) then
    return new;
  end if;
  select rule.* into matched_rule
  from public.expense_establishment_rules rule
  join public.expense_establishments establishment
    on establishment.id = rule.establishment_id
  where rule.workspace_id = effective_workspace
    and rule.is_active and rule.archived_at is null
    and establishment.status = 'active'
    and rule.match_hash = public.expense_establishment_transaction_hash(
      new, rule.match_type
    )
    and public.expense_establishment_transaction_hash(new, rule.match_type) <> ''
  order by rule.created_at
  limit 1;
  if matched_rule.id is not null then
    insert into public.expense_establishment_transactions (
      workspace_id, establishment_id, transaction_id, rule_id,
      association_source, is_active
    ) values (
      effective_workspace, matched_rule.establishment_id, new.id, matched_rule.id,
      'automatic_rule', true
    ) on conflict (transaction_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists financial_transactions_apply_expense_establishment
  on public.financial_transactions;
create trigger financial_transactions_apply_expense_establishment
after insert or update of provider_metadata, bank_direction, description, status
on public.financial_transactions
for each row execute function public.apply_expense_establishment_rule();

do $$ declare table_name text; begin
  foreach table_name in array array[
    'expense_establishments','expense_establishment_rules',
    'expense_establishment_transactions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_read', table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      table_name || '_read', table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_write', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))',
      table_name || '_write', table_name
    );
    execute format('drop trigger if exists %I on public.%I', table_name || '_scope', table_name);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.validate_expense_establishment_scope()',
      table_name || '_scope', table_name
    );
    execute format('drop trigger if exists %I on public.%I', table_name || '_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_updated_at', table_name
    );
  end loop;
end $$;

grant select, insert, update, delete on
  public.expense_establishments,
  public.expense_establishment_rules,
  public.expense_establishment_transactions
to authenticated;

commit;
