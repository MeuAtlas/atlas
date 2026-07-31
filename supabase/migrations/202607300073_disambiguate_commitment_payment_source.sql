begin;

drop function if exists public.transaction_matches_commitment_payment_source(
  public.financial_transactions,
  public.commitment_payment_sources
);

create or replace function public.transaction_matches_commitment_payment_source(
  movement public.financial_transactions,
  payment_source public.commitment_payment_sources
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  counterparty jsonb := coalesce(
    movement.provider_metadata->'counterparty',
    '{}'::jsonb
  );
  candidate text;
begin
  if payment_source.direction <> coalesce(movement.bank_direction, 'outflow')
    or (
      payment_source.account_id is not null
      and payment_source.account_id is distinct from movement.account_id
    )
  then
    return false;
  end if;

  candidate := case payment_source.identity_type
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
        then (counterparty->>'bankCode') || ':' ||
          (counterparty->>'accountMasked')
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

  return nullif(candidate, '') = payment_source.identity_value;
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
  payment_rule public.commitment_payment_sources%rowtype;
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

  for payment_rule in
    select rule.*
    from public.commitment_payment_sources rule
    join public.financial_commitments commitment
      on commitment.id = rule.commitment_id
    where rule.is_active
      and commitment.status = 'active'
      and commitment.cash_flow_direction = 'expense'
      and public.transaction_matches_commitment_payment_source(
        movement,
        rule
      )
    order by rule.created_at, rule.id
  loop
    target_occurrence_id := null;

    select occurrence.id
    into target_occurrence_id
    from public.financial_commitment_occurrences occurrence
    where occurrence.workspace_id = payment_rule.workspace_id
      and occurrence.commitment_id = payment_rule.commitment_id
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
      payment_rule.workspace_id,
      target_occurrence_id,
      movement.id,
      abs(movement.amount),
      'automatic_sync',
      1,
      false,
      payment_rule.created_by
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
  payment_rule public.commitment_payment_sources%rowtype;
  movement record;
  affected integer := 0;
begin
  select rule.*
  into payment_rule
  from public.commitment_payment_sources rule
  where rule.id = p_source_id
    and rule.is_active;

  if payment_rule.id is null then return 0; end if;

  for movement in
    select transaction.id
    from public.financial_transactions transaction
    where (
      transaction.workspace_id = payment_rule.workspace_id
      or (
        transaction.workspace_id is null
        and transaction.owner_id = payment_rule.created_by
      )
    )
      and transaction.status in ('realized','paid')
      and public.transaction_matches_commitment_payment_source(
        transaction,
        payment_rule
      )
  loop
    affected := affected
      + public.apply_commitment_payment_source_to_transaction(movement.id);
  end loop;

  return affected;
end;
$$;

commit;
