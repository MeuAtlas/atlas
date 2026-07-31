begin;

-- A commitment can be paid by more than one bank transaction in the same
-- competence. The junction table is canonical; linked_transaction_id remains
-- only as a backwards-compatible pointer to the first payment.

create table if not exists public.commitment_payment_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  commitment_id uuid not null
    references public.financial_commitments(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  account_id uuid references public.financial_accounts(id) on delete cascade,
  identity_type text not null check (identity_type in (
    'provider_counterparty_id',
    'tax_number_hash',
    'pix_key_hash',
    'bank_account',
    'merchant_identifier',
    'normalized_name',
    'description'
  )),
  identity_value text not null check (char_length(identity_value) between 3 and 256),
  direction text not null default 'outflow'
    check (direction in ('inflow','outflow')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commitment_payment_sources_identity_idx
on public.commitment_payment_sources (
  workspace_id,
  identity_type,
  identity_value,
  coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
  direction
)
where is_active;

create index if not exists commitment_payment_sources_commitment_idx
on public.commitment_payment_sources(workspace_id, commitment_id)
where is_active;

alter table public.commitment_payment_sources enable row level security;

drop policy if exists commitment_payment_sources_read
  on public.commitment_payment_sources;
create policy commitment_payment_sources_read
on public.commitment_payment_sources
for select to authenticated
using (public.is_workspace_member(workspace_id));

drop policy if exists commitment_payment_sources_write
  on public.commitment_payment_sources;
create policy commitment_payment_sources_write
on public.commitment_payment_sources
for all to authenticated
using (
  created_by = auth.uid()
  and public.can_edit_workspace(workspace_id)
)
with check (
  created_by = auth.uid()
  and public.can_edit_workspace(workspace_id)
);

grant select, insert, update, delete
  on public.commitment_payment_sources to authenticated;

create or replace function public.validate_financial_occurrence_transaction_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  occurrence_workspace uuid;
  occurrence_creator uuid;
  transaction_workspace uuid;
  transaction_owner uuid;
begin
  select occurrence.workspace_id, occurrence.created_by
  into occurrence_workspace, occurrence_creator
  from public.financial_commitment_occurrences occurrence
  where occurrence.id = new.occurrence_id;

  select transaction.workspace_id, transaction.owner_id
  into transaction_workspace, transaction_owner
  from public.financial_transactions transaction
  where transaction.id = new.transaction_id;

  if occurrence_workspace is null
    or occurrence_workspace <> new.workspace_id
    or (
      transaction_workspace is distinct from new.workspace_id
      and not (
        transaction_workspace is null
        and (
          transaction_owner = auth.uid()
          or transaction_owner = occurrence_creator
          or auth.role() = 'service_role'
        )
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'financial_occurrence_transaction_scope_mismatch';
  end if;

  new.created_by := coalesce(auth.uid(), occurrence_creator, new.created_by);
  return new;
end;
$$;

create or replace function public.normalize_commitment_payment_identity(
  input text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(
          lower(coalesce(input, '')),
          'áàâãäéèêëíìîïóòôõöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.commitment_payment_transaction_identity(
  movement public.financial_transactions
)
returns table(identity_type text, identity_value text)
language plpgsql
stable
set search_path = ''
as $$
declare
  counterparty jsonb := coalesce(movement.provider_metadata->'counterparty', '{}'::jsonb);
  value text;
begin
  value := nullif(coalesce(
    counterparty->>'providerCounterpartyId',
    counterparty->>'id'
  ), '');
  if value is not null then
    return query select 'provider_counterparty_id'::text, value;
    return;
  end if;

  value := nullif(counterparty->>'taxNumberHash', '');
  if value is not null then
    return query select 'tax_number_hash'::text, value;
    return;
  end if;

  value := nullif(counterparty->>'pixKeyHash', '');
  if value is not null then
    return query select 'pix_key_hash'::text, value;
    return;
  end if;

  if nullif(counterparty->>'bankCode', '') is not null
    and nullif(counterparty->>'accountMasked', '') is not null
  then
    return query select
      'bank_account'::text,
      (counterparty->>'bankCode') || ':' || (counterparty->>'accountMasked');
    return;
  end if;

  value := nullif(counterparty->>'merchantIdentifier', '');
  if value is not null then
    return query select 'merchant_identifier'::text, value;
    return;
  end if;

  value := public.normalize_commitment_payment_identity(coalesce(
    counterparty->>'normalizedName',
    counterparty->>'displayName',
    movement.merchant
  ));
  if value is not null then
    return query select 'normalized_name'::text, value;
    return;
  end if;

  value := public.normalize_commitment_payment_identity(movement.description);
  return query select 'description'::text, value;
end;
$$;

create or replace function public.transaction_matches_commitment_payment_source(
  movement public.financial_transactions,
  source public.commitment_payment_sources
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  counterparty jsonb := coalesce(movement.provider_metadata->'counterparty', '{}'::jsonb);
  candidate text;
begin
  if source.direction <> coalesce(movement.bank_direction, 'outflow')
    or (source.account_id is not null and source.account_id is distinct from movement.account_id)
  then
    return false;
  end if;

  candidate := case source.identity_type
    when 'provider_counterparty_id' then coalesce(
      counterparty->>'providerCounterpartyId',
      counterparty->>'id'
    )
    when 'tax_number_hash' then counterparty->>'taxNumberHash'
    when 'pix_key_hash' then counterparty->>'pixKeyHash'
    when 'bank_account' then
      case
        when nullif(counterparty->>'bankCode', '') is not null
          and nullif(counterparty->>'accountMasked', '') is not null
        then (counterparty->>'bankCode') || ':' || (counterparty->>'accountMasked')
        else null
      end
    when 'merchant_identifier' then counterparty->>'merchantIdentifier'
    when 'normalized_name' then
      public.normalize_commitment_payment_identity(coalesce(
        counterparty->>'normalizedName',
        counterparty->>'displayName',
        movement.merchant
      ))
    when 'description' then
      public.normalize_commitment_payment_identity(movement.description)
    else null
  end;

  return nullif(candidate, '') = source.identity_value;
end;
$$;

create or replace function public.recalculate_financial_occurrence_payments(
  p_occurrence_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.financial_commitment_occurrences%rowtype;
  total_paid numeric(15,2);
  payment_count integer;
  last_payment_date date;
  first_transaction_id uuid;
  restored_status text;
  today_in_brasilia date := timezone('America/Sao_Paulo', now())::date;
begin
  select occurrence.*
  into target
  from public.financial_commitment_occurrences occurrence
  where occurrence.id = p_occurrence_id
  for update;

  if target.id is null then return; end if;

  select
    coalesce(sum(link.allocated_amount), 0),
    count(*)::integer,
    max(transaction.competence_date),
    (array_agg(
      transaction.id
      order by transaction.competence_date, link.created_at, transaction.id
    ))[1]
  into total_paid, payment_count, last_payment_date, first_transaction_id
  from public.financial_occurrence_transactions link
  join public.financial_transactions transaction
    on transaction.id = link.transaction_id
  where link.occurrence_id = target.id;

  restored_status := case
    when target.status in ('cancelled','skipped','disputed') then target.status
    when total_paid >= coalesce(target.expected_amount, 0) - 0.01
      and total_paid > 0 then 'paid'
    when total_paid > 0 then 'partially_paid'
    when target.expected_due_date < today_in_brasilia then 'overdue'
    when target.expected_due_date is not null
      and date_trunc('month', target.expected_due_date)
        = date_trunc('month', today_in_brasilia) then 'pending'
    else 'projected'
  end;

  update public.financial_commitment_occurrences occurrence
  set
    linked_transaction_id = first_transaction_id,
    actual_amount = case when payment_count = 0 then null else total_paid end,
    paid_amount = total_paid,
    linked_transactions_count = payment_count,
    payment_date = last_payment_date,
    status = restored_status,
    manually_confirmed = payment_count > 0,
    match_source = case
      when payment_count = 0 then null
      when payment_count = 1 then 'manual'
      else 'multiple_payments'
    end,
    match_confidence = case when payment_count = 0 then null else 1 end,
    realized_at = last_payment_date::timestamptz,
    updated_at = now()
  where occurrence.id = target.id;
end;
$$;

create or replace function public.apply_commitment_payment_source_to_transaction(
  p_transaction_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  movement public.financial_transactions%rowtype;
  source public.commitment_payment_sources%rowtype;
  target_occurrence_id uuid;
  affected integer := 0;
begin
  select transaction.*
  into movement
  from public.financial_transactions transaction
  where transaction.id = p_transaction_id;

  if movement.id is null
    or coalesce(movement.bank_direction, 'outflow') <> 'outflow'
    or movement.status not in ('realized','paid')
  then
    return 0;
  end if;

  for source in
    select rule.*
    from public.commitment_payment_sources rule
    join public.financial_commitments commitment
      on commitment.id = rule.commitment_id
    where rule.is_active
      and commitment.status = 'active'
      and commitment.cash_flow_direction = 'expense'
      and public.transaction_matches_commitment_payment_source(movement, rule)
    order by rule.created_at, rule.id
  loop
    select occurrence.id
    into target_occurrence_id
    from public.financial_commitment_occurrences occurrence
    where occurrence.workspace_id = source.workspace_id
      and occurrence.commitment_id = source.commitment_id
      and occurrence.competence_month
        = date_trunc('month', movement.competence_date)::date
      and occurrence.status not in ('cancelled','skipped','disputed')
    order by occurrence.sequence_number
    limit 1;

    if target_occurrence_id is null then continue; end if;

    insert into public.financial_occurrence_transactions (
      workspace_id,
      occurrence_id,
      transaction_id,
      allocated_amount,
      link_source,
      confidence,
      manually_confirmed,
      created_by
    )
    values (
      source.workspace_id,
      target_occurrence_id,
      movement.id,
      abs(movement.amount),
      'automatic_sync',
      1,
      false,
      source.created_by
    )
    on conflict (transaction_id) do nothing;

    if found then
      perform public.recalculate_financial_occurrence_payments(
        target_occurrence_id
      );
      affected := affected + 1;
    end if;
  end loop;

  return affected;
end;
$$;

create or replace function public.apply_commitment_payment_source_to_existing(
  p_source_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  source public.commitment_payment_sources%rowtype;
  movement record;
  affected integer := 0;
begin
  select rule.*
  into source
  from public.commitment_payment_sources rule
  where rule.id = p_source_id
    and rule.is_active;

  if source.id is null then return 0; end if;

  for movement in
    select transaction.id
    from public.financial_transactions transaction
    where (
      transaction.workspace_id = source.workspace_id
      or (
        transaction.workspace_id is null
        and transaction.owner_id = source.created_by
      )
    )
      and transaction.status in ('realized','paid')
      and public.transaction_matches_commitment_payment_source(
        transaction,
        source
      )
  loop
    affected := affected
      + public.apply_commitment_payment_source_to_transaction(movement.id);
  end loop;

  return affected;
end;
$$;

create or replace function public.save_commitment_payment_source(
  p_workspace_id uuid,
  p_commitment_id uuid,
  p_created_by uuid,
  p_movement public.financial_transactions
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  identity record;
  saved_id uuid;
  description_source_id uuid;
  normalized_description text;
begin
  select *
  into identity
  from public.commitment_payment_transaction_identity(p_movement);

  if identity.identity_value is null then return null; end if;

  select source.id
  into saved_id
  from public.commitment_payment_sources source
  where source.workspace_id = p_workspace_id
    and source.identity_type = identity.identity_type
    and source.identity_value = identity.identity_value
    and source.account_id is not distinct from p_movement.account_id
    and source.direction = 'outflow'
    and source.is_active
  limit 1;

  if saved_id is null then
    insert into public.commitment_payment_sources (
      workspace_id,
      commitment_id,
      created_by,
      account_id,
      identity_type,
      identity_value,
      direction
    )
    values (
      p_workspace_id,
      p_commitment_id,
      p_created_by,
      p_movement.account_id,
      identity.identity_type,
      identity.identity_value,
      'outflow'
    )
    returning id into saved_id;
  elsif exists (
    select 1
    from public.commitment_payment_sources source
    where source.id = saved_id
      and source.commitment_id <> p_commitment_id
  ) then
    -- A destination cannot silently pay two commitments.
    return null;
  end if;

  normalized_description :=
    public.normalize_commitment_payment_identity(p_movement.description);
  if identity.identity_type <> 'description'
    and normalized_description is not null
    and char_length(normalized_description) >= 12
    and array_length(regexp_split_to_array(normalized_description, '\s+'), 1) >= 2
  then
    insert into public.commitment_payment_sources (
      workspace_id,
      commitment_id,
      created_by,
      account_id,
      identity_type,
      identity_value,
      direction
    )
    values (
      p_workspace_id,
      p_commitment_id,
      p_created_by,
      p_movement.account_id,
      'description',
      normalized_description,
      'outflow'
    )
    on conflict do nothing
    returning id into description_source_id;

    if description_source_id is null then
      select source.id
      into description_source_id
      from public.commitment_payment_sources source
      where source.workspace_id = p_workspace_id
        and source.commitment_id = p_commitment_id
        and source.identity_type = 'description'
        and source.identity_value = normalized_description
        and source.account_id is not distinct from p_movement.account_id
        and source.direction = 'outflow'
        and source.is_active
      limit 1;
    end if;
  end if;

  perform public.apply_commitment_payment_source_to_existing(saved_id);
  if description_source_id is not null then
    perform public.apply_commitment_payment_source_to_existing(
      description_source_id
    );
  end if;
  return saved_id;
end;
$$;

create or replace function public.link_financial_transaction_to_occurrence(
  p_workspace_id uuid,
  p_occurrence_id uuid,
  p_transaction_id uuid,
  p_replace_existing boolean default false
)
returns table (
  outcome text,
  previous_occurrence_id uuid,
  previous_commitment_id uuid,
  previous_commitment_title text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_occurrence public.financial_commitment_occurrences%rowtype;
  existing_occurrence public.financial_commitment_occurrences%rowtype;
  movement public.financial_transactions%rowtype;
  source_id uuid;
begin
  select occurrence.*
  into target_occurrence
  from public.financial_commitment_occurrences occurrence
  where occurrence.workspace_id = p_workspace_id
    and occurrence.id = p_occurrence_id
  for update;

  if target_occurrence.id is null then
    raise exception using errcode = 'P0002',
      message = 'target_occurrence_not_found';
  end if;

  select transaction.*
  into movement
  from public.financial_transactions transaction
  where transaction.id = p_transaction_id
    and (
      transaction.workspace_id = p_workspace_id
      or (
        transaction.workspace_id is null
        and transaction.owner_id = auth.uid()
      )
    )
  for update;

  if movement.id is null then
    raise exception using errcode = 'P0002',
      message = 'financial_transaction_not_found';
  end if;

  select occurrence.*
  into existing_occurrence
  from public.financial_occurrence_transactions link
  join public.financial_commitment_occurrences occurrence
    on occurrence.id = link.occurrence_id
  where link.transaction_id = p_transaction_id
  for update of occurrence;

  if existing_occurrence.id is null then
    select occurrence.*
    into existing_occurrence
    from public.financial_commitment_occurrences occurrence
    where occurrence.workspace_id = p_workspace_id
      and occurrence.linked_transaction_id = p_transaction_id
    for update;
  end if;

  if existing_occurrence.id is not null
    and existing_occurrence.id <> target_occurrence.id
    and not p_replace_existing
  then
    return query
      select
        'conflict'::text,
        existing_occurrence.id,
        existing_occurrence.commitment_id,
        commitment.title
      from public.financial_commitments commitment
      where commitment.id = existing_occurrence.commitment_id;
    return;
  end if;

  if existing_occurrence.id is not null
    and existing_occurrence.id <> target_occurrence.id
  then
    delete from public.financial_occurrence_transactions link
    where link.transaction_id = p_transaction_id;
    update public.financial_commitment_occurrences occurrence
    set linked_transaction_id = null
    where occurrence.id = existing_occurrence.id
      and occurrence.linked_transaction_id = p_transaction_id;
    perform public.recalculate_financial_occurrence_payments(
      existing_occurrence.id
    );
  end if;

  insert into public.financial_occurrence_transactions (
    workspace_id,
    occurrence_id,
    transaction_id,
    allocated_amount,
    link_source,
    confidence,
    manually_confirmed,
    created_by
  )
  values (
    p_workspace_id,
    target_occurrence.id,
    movement.id,
    abs(movement.amount),
    'manual',
    1,
    true,
    target_occurrence.created_by
  )
  on conflict (occurrence_id, transaction_id) do update
  set
    allocated_amount = excluded.allocated_amount,
    link_source = 'manual',
    confidence = 1,
    manually_confirmed = true;

  perform public.recalculate_financial_occurrence_payments(
    target_occurrence.id
  );
  source_id := public.save_commitment_payment_source(
    p_workspace_id,
    target_occurrence.commitment_id,
    target_occurrence.created_by,
    movement
  );
  perform public.recalculate_financial_occurrence_payments(
    target_occurrence.id
  );

  if existing_occurrence.id = target_occurrence.id then
    return query select
      'already_linked'::text,
      target_occurrence.id,
      target_occurrence.commitment_id,
      null::text;
  elsif existing_occurrence.id is not null then
    return query
      select
        'replaced'::text,
        existing_occurrence.id,
        existing_occurrence.commitment_id,
        commitment.title
      from public.financial_commitments commitment
      where commitment.id = existing_occurrence.commitment_id;
  else
    return query select
      'linked'::text,
      null::uuid,
      null::uuid,
      null::text;
  end if;
end;
$$;

create or replace function public.unlink_financial_occurrence_payments(
  p_workspace_id uuid,
  p_occurrence_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target public.financial_commitment_occurrences%rowtype;
begin
  select occurrence.*
  into target
  from public.financial_commitment_occurrences occurrence
  where occurrence.workspace_id = p_workspace_id
    and occurrence.id = p_occurrence_id
  for update;

  if target.id is null then
    raise exception using errcode = 'P0002',
      message = 'target_occurrence_not_found';
  end if;

  delete from public.financial_occurrence_transactions link
  where link.workspace_id = p_workspace_id
    and link.occurrence_id = target.id;

  update public.commitment_payment_sources source
  set is_active = false, updated_at = now()
  where source.workspace_id = p_workspace_id
    and source.commitment_id = target.commitment_id
    and source.created_by = auth.uid()
    and source.is_active;

  perform public.recalculate_financial_occurrence_payments(target.id);
end;
$$;

revoke all on function public.unlink_financial_occurrence_payments(uuid, uuid)
  from public;
grant execute on function public.unlink_financial_occurrence_payments(uuid, uuid)
  to authenticated;

create or replace function public.apply_commitment_payment_sources_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.apply_commitment_payment_source_to_transaction(new.id);
  return new;
end;
$$;

drop trigger if exists financial_transactions_apply_commitment_payment_sources
  on public.financial_transactions;
create trigger financial_transactions_apply_commitment_payment_sources
after insert or update of
  description,
  merchant,
  provider_metadata,
  amount,
  competence_date,
  status,
  bank_direction,
  account_id
on public.financial_transactions
for each row execute function
  public.apply_commitment_payment_sources_trigger();

-- Repair transactions linked after migration 064 by the legacy RPC.
insert into public.financial_occurrence_transactions (
  workspace_id,
  occurrence_id,
  transaction_id,
  allocated_amount,
  link_source,
  confidence,
  manually_confirmed,
  created_by,
  created_at
)
select
  occurrence.workspace_id,
  occurrence.id,
  occurrence.linked_transaction_id,
  abs(transaction.amount),
  'legacy',
  coalesce(occurrence.match_confidence, 1),
  occurrence.manually_confirmed,
  occurrence.created_by,
  occurrence.updated_at
from public.financial_commitment_occurrences occurrence
join public.financial_transactions transaction
  on transaction.id = occurrence.linked_transaction_id
left join public.financial_occurrence_transactions link
  on link.transaction_id = occurrence.linked_transaction_id
where occurrence.linked_transaction_id is not null
  and link.id is null
on conflict (transaction_id) do nothing;

do $$
declare
  occurrence record;
begin
  for occurrence in
    select distinct link.occurrence_id
    from public.financial_occurrence_transactions link
  loop
    perform public.recalculate_financial_occurrence_payments(
      occurrence.occurrence_id
    );
  end loop;
end;
$$;

commit;
