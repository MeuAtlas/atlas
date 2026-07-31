begin;

create table if not exists public.financial_analysis_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 120),
  group_type text not null check (group_type in (
    'income_source','expense_context','household','dependent','work','travel','project','custom'
  )),
  description text check (description is null or char_length(description) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, normalized_name)
);

create table if not exists public.financial_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  normalized_name text not null check (char_length(btrim(normalized_name)) between 1 and 160),
  entity_type text not null check (entity_type in (
    'employer','payer','company','supplier','merchant','service_provider','lodging',
    'financial_institution','person','dependent','household','government','other'
  )),
  default_direction text check (default_direction is null or default_direction in (
    'incoming','outgoing','both'
  )),
  default_nature text check (default_nature is null or default_nature in (
    'income','expense','reimbursement','transfer','refund','advance','investment','neutral','other'
  )),
  default_category_id uuid references public.financial_categories(id) on delete set null,
  default_group_id uuid references public.financial_analysis_groups(id) on delete set null,
  linked_person_id uuid references public.financial_people(id) on delete set null,
  is_primary_income_source boolean not null default false,
  expected_amount numeric(15,2) check (expected_amount is null or expected_amount >= 0),
  expected_periodicity text check (expected_periodicity is null or expected_periodicity in (
    'weekly','biweekly','monthly','bimonthly','quarterly','semiannual','annual','irregular'
  )),
  expected_day integer check (expected_day is null or expected_day between 1 and 31),
  planning_enabled boolean not null default false,
  amount_tolerance numeric(15,2) check (amount_tolerance is null or amount_tolerance >= 0),
  income_subtype text check (income_subtype is null or income_subtype in (
    'salary','vacation','thirteenth_salary','corporate_reimbursement',
    'profit_sharing','additional','other'
  )),
  is_frequent_expense boolean not null default false,
  average_expected_expense numeric(15,2)
    check (average_expected_expense is null or average_expected_expense >= 0),
  is_active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, normalized_name),
  unique (linked_person_id)
);

alter table public.person_counterparties
  add column if not exists financial_entity_id uuid
    references public.financial_entities(id) on delete set null;

create table if not exists public.financial_entity_counterparties (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entity_id uuid not null references public.financial_entities(id) on delete cascade,
  provider text,
  counterparty_type text not null check (counterparty_type in (
    'provider_counterparty','pix_key','tax_number','bank_account','normalized_name',
    'composite','merchant_identifier','other'
  )),
  display_name text,
  normalized_name text,
  provider_counterparty_id text,
  tax_number_hash text,
  masked_tax_number text,
  pix_key_hash text,
  masked_pix_key text,
  bank_code text,
  bank_name text,
  branch_masked text,
  account_masked text,
  merchant_identifier text,
  direction_scope text not null default 'both'
    check (direction_scope in ('incoming_only','outgoing_only','both')),
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  match_priority integer not null default 100 check (match_priority between 1 and 1000),
  manually_confirmed boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (
    counterparty_type = 'other'
    or provider_counterparty_id is not null
    or tax_number_hash is not null
    or pix_key_hash is not null
    or normalized_name is not null
    or merchant_identifier is not null
    or (bank_code is not null and account_masked is not null)
  )
);

create table if not exists public.financial_classification_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  entity_id uuid references public.financial_entities(id) on delete set null,
  category_id uuid references public.financial_categories(id) on delete set null,
  group_id uuid references public.financial_analysis_groups(id) on delete set null,
  linked_person_id uuid references public.financial_people(id) on delete set null,
  direction_scope text not null check (direction_scope in (
    'incoming_only','outgoing_only','both'
  )),
  resulting_nature text check (resulting_nature is null or resulting_nature in (
    'income','expense','reimbursement','transfer','refund','advance','investment','neutral','other'
  )),
  source_type_scope text not null default 'all' check (source_type_scope in (
    'bank','card','pix','transfer','boleto','debit','credit','all'
  )),
  transaction_type_scope text,
  priority integer not null default 100 check (priority between 1 and 1000),
  is_active boolean not null default true,
  apply_to_history boolean not null default false,
  auto_apply boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  check (entity_id is not null or category_id is not null or group_id is not null
    or linked_person_id is not null or resulting_nature is not null)
);

create table if not exists public.financial_rule_conditions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_id uuid not null references public.financial_classification_rules(id) on delete cascade,
  field_name text not null check (field_name in (
    'provider_counterparty_id','pix_key_hash','tax_number_hash',
    'normalized_counterparty_name','bank_name','account_masked','merchant_name',
    'description','transaction_type','amount','provider_category','direction',
    'account_id','card_id'
  )),
  operator text not null check (operator in (
    'equals','contains','starts_with','ends_with','range','in',
    'matches_normalized','hash_equals'
  )),
  comparison_value text,
  comparison_hash text,
  numeric_min numeric(15,2),
  numeric_max numeric(15,2),
  date_from date,
  date_until date,
  created_at timestamptz not null default now(),
  check (date_until is null or date_from is null or date_until >= date_from),
  check (
    (operator = 'range' and (numeric_min is not null or numeric_max is not null))
    or (operator = 'hash_equals' and comparison_hash is not null)
    or (operator not in ('range','hash_equals') and comparison_value is not null)
  )
);

create table if not exists public.transaction_entities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid references public.financial_transactions(id) on delete cascade,
  card_movement_id uuid references public.card_purchases(id) on delete cascade,
  entity_id uuid not null references public.financial_entities(id) on delete cascade,
  rule_id uuid references public.financial_classification_rules(id) on delete set null,
  group_id uuid references public.financial_analysis_groups(id) on delete set null,
  category_id uuid references public.financial_categories(id) on delete set null,
  assigned_nature text check (assigned_nature is null or assigned_nature in (
    'income','expense','reimbursement','transfer','refund','advance','investment','neutral','other'
  )),
  income_subtype text check (income_subtype is null or income_subtype in (
    'salary','vacation','thirteenth_salary','corporate_reimbursement',
    'profit_sharing','additional','other'
  )),
  match_confidence numeric(5,4) check (
    match_confidence is null or match_confidence between 0 and 1
  ),
  match_source text not null check (match_source in (
    'manual','automatic_rule','counterparty_match','suggestion',
    'historical_backfill','system'
  )),
  is_primary boolean not null default true,
  manually_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(transaction_id, card_movement_id) = 1),
  unique (transaction_id, entity_id),
  unique (card_movement_id, entity_id)
);

create unique index if not exists transaction_entities_one_primary_transaction_idx
  on public.transaction_entities(transaction_id)
  where transaction_id is not null and is_primary;
create unique index if not exists transaction_entities_one_primary_card_idx
  on public.transaction_entities(card_movement_id)
  where card_movement_id is not null and is_primary;

create table if not exists public.financial_entity_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  transaction_id uuid references public.financial_transactions(id) on delete cascade,
  card_movement_id uuid references public.card_purchases(id) on delete cascade,
  suggested_entity_id uuid references public.financial_entities(id) on delete cascade,
  fingerprint text not null,
  suggestion_type text not null check (suggestion_type in (
    'create_entity','link_existing','possible_income_source','possible_supplier',
    'refund_or_reimbursement','conflict'
  )),
  suggested_name text,
  suggested_entity_type text,
  direction_scope text check (direction_scope is null or direction_scope in (
    'incoming_only','outgoing_only','both'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  reason_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending','accepted','rejected','expired'
  )),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (workspace_id, fingerprint)
);

create index if not exists financial_entities_workspace_idx
  on public.financial_entities(workspace_id);
create index if not exists financial_entities_type_active_idx
  on public.financial_entities(workspace_id, entity_type, is_active)
  where archived_at is null;
create index if not exists financial_analysis_groups_workspace_idx
  on public.financial_analysis_groups(workspace_id, group_type, is_active)
  where archived_at is null;
create index if not exists entity_counterparties_entity_idx
  on public.financial_entity_counterparties(entity_id);
create index if not exists entity_counterparties_provider_idx
  on public.financial_entity_counterparties(workspace_id, provider_counterparty_id)
  where provider_counterparty_id is not null and is_active and archived_at is null;
create index if not exists entity_counterparties_pix_idx
  on public.financial_entity_counterparties(workspace_id, pix_key_hash)
  where pix_key_hash is not null and is_active and archived_at is null;
create index if not exists entity_counterparties_tax_idx
  on public.financial_entity_counterparties(workspace_id, tax_number_hash)
  where tax_number_hash is not null and is_active and archived_at is null;
create index if not exists entity_counterparties_name_idx
  on public.financial_entity_counterparties(workspace_id, normalized_name)
  where normalized_name is not null and is_active and archived_at is null;
create index if not exists classification_rules_active_idx
  on public.financial_classification_rules(workspace_id, is_active, priority);
create index if not exists classification_rules_entity_idx
  on public.financial_classification_rules(entity_id);
create index if not exists rule_conditions_rule_idx
  on public.financial_rule_conditions(rule_id);
create index if not exists transaction_entities_workspace_entity_idx
  on public.transaction_entities(workspace_id, entity_id);
create index if not exists transaction_entities_transaction_idx
  on public.transaction_entities(transaction_id) where transaction_id is not null;
create index if not exists transaction_entities_card_idx
  on public.transaction_entities(card_movement_id) where card_movement_id is not null;
create index if not exists entity_suggestions_pending_idx
  on public.financial_entity_suggestions(workspace_id, status, confidence desc);
create index if not exists person_counterparties_entity_idx
  on public.person_counterparties(financial_entity_id)
  where financial_entity_id is not null;

create unique index if not exists entity_counterparties_identity_idx
  on public.financial_entity_counterparties (
    workspace_id, entity_id, counterparty_type,
    coalesce(provider_counterparty_id, ''),
    coalesce(tax_number_hash, ''),
    coalesce(pix_key_hash, ''),
    coalesce(bank_code, ''),
    coalesce(account_masked, ''),
    coalesce(merchant_identifier, ''),
    coalesce(normalized_name, '')
  ) where archived_at is null;

create or replace function public.validate_financial_entity_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  target_workspace uuid;
  person_workspace uuid;
begin
  if not public.can_edit_workspace(new.workspace_id) then
    raise exception 'financial entity write access denied';
  end if;
  if tg_table_name = 'financial_entities' and new.linked_person_id is not null then
    select workspace_id into person_workspace from public.financial_people
      where id = new.linked_person_id and archived_at is null;
    if person_workspace is distinct from new.workspace_id then
      raise exception 'linked person workspace mismatch';
    end if;
  elsif tg_table_name = 'financial_entity_counterparties' then
    select workspace_id into target_workspace from public.financial_entities
      where id = new.entity_id and archived_at is null;
  elsif tg_table_name = 'financial_classification_rules' then
    if new.entity_id is not null then
      select workspace_id into target_workspace from public.financial_entities
        where id = new.entity_id and archived_at is null;
    end if;
    if new.linked_person_id is not null then
      select workspace_id into person_workspace from public.financial_people
        where id = new.linked_person_id and archived_at is null;
      if person_workspace is distinct from new.workspace_id then
        raise exception 'rule person workspace mismatch';
      end if;
    end if;
  elsif tg_table_name = 'financial_rule_conditions' then
    select workspace_id into target_workspace from public.financial_classification_rules
      where id = new.rule_id and archived_at is null;
  elsif tg_table_name = 'transaction_entities' then
    select workspace_id into target_workspace from public.financial_entities
      where id = new.entity_id and archived_at is null;
    if target_workspace is distinct from new.workspace_id then
      raise exception 'entity link workspace mismatch';
    end if;
    if new.transaction_id is not null then
      select workspace_id into target_workspace from public.financial_transactions
        where id = new.transaction_id;
    else
      select workspace_id into target_workspace from public.card_purchases
        where id = new.card_movement_id;
    end if;
  end if;
  if target_workspace is distinct from new.workspace_id then
    raise exception 'financial entity workspace mismatch';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'financial_analysis_groups','financial_entities',
    'financial_entity_counterparties','financial_classification_rules',
    'transaction_entities'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_set_updated_at', t
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
  foreach t in array array[
    'financial_entities','financial_entity_counterparties',
    'financial_classification_rules','financial_rule_conditions',
    'transaction_entities'
  ] loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_validate_scope', t
    );
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.validate_financial_entity_scope()',
      t || '_validate_scope', t
    );
  end loop;
end $$;

create or replace function public.validate_person_counterparty_entity_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare target_workspace uuid;
begin
  if new.financial_entity_id is null then return new; end if;
  select workspace_id into target_workspace from public.financial_entities
    where id = new.financial_entity_id and archived_at is null;
  if target_workspace is distinct from new.workspace_id then
    raise exception 'person counterparty entity workspace mismatch';
  end if;
  return new;
end $$;
drop trigger if exists person_counterparties_validate_entity_scope
  on public.person_counterparties;
create trigger person_counterparties_validate_entity_scope
before insert or update of financial_entity_id on public.person_counterparties
for each row execute function public.validate_person_counterparty_entity_scope();

create or replace function public.apply_financial_entity_rules_for_transaction()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  matched_rule public.financial_classification_rules%rowtype;
begin
  if new.workspace_id is null
    or new.bank_direction not in ('inflow','outflow')
    or coalesce(new.manually_confirmed, false)
    or new.manual_override_at is not null
    or exists (
      select 1 from public.transaction_entities link
      where link.transaction_id = new.id and link.is_primary
        and link.manually_confirmed
    )
  then return new; end if;

  select rule.* into matched_rule
  from public.financial_classification_rules rule
  where rule.workspace_id = new.workspace_id
    and rule.is_active and rule.auto_apply and rule.archived_at is null
    and rule.entity_id is not null
    and (rule.valid_from is null or rule.valid_from <= new.competence_date)
    and (rule.valid_until is null or rule.valid_until >= new.competence_date)
    and (
      rule.direction_scope = 'both'
      or rule.direction_scope = 'incoming_only' and new.bank_direction = 'inflow'
      or rule.direction_scope = 'outgoing_only' and new.bank_direction = 'outflow'
    )
    and exists (
      select 1 from public.financial_rule_conditions condition
      where condition.rule_id = rule.id
    )
    and not exists (
      select 1
      from public.financial_rule_conditions condition
      cross join lateral (
        select case condition.field_name
          when 'provider_counterparty_id' then
            new.provider_metadata #>> '{counterparty,providerCounterpartyId}'
          when 'pix_key_hash' then new.provider_metadata #>> '{counterparty,pixKeyHash}'
          when 'tax_number_hash' then new.provider_metadata #>> '{counterparty,taxNumberHash}'
          when 'normalized_counterparty_name' then lower(regexp_replace(
            translate(coalesce(
              new.provider_metadata #>> '{counterparty,displayName}',
              new.merchant, new.description
            ), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc'),
            '[^a-zA-Z0-9]+', ' ', 'g'
          ))
          when 'bank_name' then new.provider_metadata #>> '{counterparty,bankName}'
          when 'account_masked' then new.provider_metadata #>> '{counterparty,accountMasked}'
          when 'merchant_name' then new.merchant
          when 'description' then new.description
          when 'transaction_type' then new.transaction_type
          when 'provider_category' then new.provider_category
          when 'direction' then new.bank_direction
          when 'account_id' then new.account_id::text
          when 'card_id' then new.credit_card_id::text
          when 'amount' then new.amount::text
          else null
        end as actual_value
      ) value
      where condition.rule_id = rule.id
        and not (
          condition.operator = 'range' and
            (condition.numeric_min is null or new.amount >= condition.numeric_min) and
            (condition.numeric_max is null or new.amount <= condition.numeric_max)
          or condition.operator = 'hash_equals'
            and value.actual_value = condition.comparison_hash
          or condition.operator in ('equals','matches_normalized')
            and lower(value.actual_value) = lower(condition.comparison_value)
          or condition.operator = 'contains'
            and lower(value.actual_value) like '%' || lower(condition.comparison_value) || '%'
          or condition.operator = 'starts_with'
            and lower(value.actual_value) like lower(condition.comparison_value) || '%'
          or condition.operator = 'ends_with'
            and lower(value.actual_value) like '%' || lower(condition.comparison_value)
          or condition.operator = 'in'
            and lower(value.actual_value) = any(string_to_array(lower(condition.comparison_value), ','))
        )
    )
  order by rule.priority, rule.created_at
  limit 1;

  if matched_rule.id is not null then
    insert into public.transaction_entities (
      workspace_id, transaction_id, entity_id, rule_id, group_id, category_id,
      assigned_nature, match_confidence, match_source, manually_confirmed, is_primary
    ) values (
      new.workspace_id, new.id, matched_rule.entity_id, matched_rule.id,
      matched_rule.group_id, matched_rule.category_id,
      matched_rule.resulting_nature, 0.99, 'automatic_rule', false, true
    )
    on conflict (transaction_id, entity_id) do update set
      rule_id = excluded.rule_id,
      group_id = coalesce(public.transaction_entities.group_id, excluded.group_id),
      category_id = coalesce(public.transaction_entities.category_id, excluded.category_id),
      assigned_nature = coalesce(
        public.transaction_entities.assigned_nature, excluded.assigned_nature
      ),
      match_confidence = excluded.match_confidence,
      match_source = case
        when public.transaction_entities.manually_confirmed
          then public.transaction_entities.match_source
        else excluded.match_source
      end,
      updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists financial_transactions_apply_entity_rules
  on public.financial_transactions;
create trigger financial_transactions_apply_entity_rules
after insert or update of provider_metadata, bank_direction, competence_date,
  merchant, description, status
on public.financial_transactions
for each row execute function public.apply_financial_entity_rules_for_transaction();

do $$ declare t text; begin
  foreach t in array array[
    'financial_analysis_groups','financial_entities',
    'financial_entity_counterparties','financial_classification_rules',
    'financial_rule_conditions','transaction_entities','financial_entity_suggestions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_workspace_member(workspace_id))',
      t || '_read', t
    );
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_insert', t
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.can_edit_workspace(workspace_id))',
      t || '_insert', t
    );
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_update', t
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id))',
      t || '_update', t
    );
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_delete', t
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.can_edit_workspace(workspace_id))',
      t || '_delete', t
    );
  end loop;
end $$;

grant select, insert, update, delete on
  public.financial_analysis_groups,
  public.financial_entities,
  public.financial_entity_counterparties,
  public.financial_classification_rules,
  public.financial_rule_conditions,
  public.transaction_entities,
  public.financial_entity_suggestions
to authenticated;

commit;
