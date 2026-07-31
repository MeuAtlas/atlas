begin;

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
  restored_status text;
  target_status text;
  today_in_brasilia date := timezone('America/Sao_Paulo', now())::date;
begin
  select occurrence.*
  into target_occurrence
  from public.financial_commitment_occurrences occurrence
  where occurrence.workspace_id = p_workspace_id
    and occurrence.id = p_occurrence_id
  for update;

  if target_occurrence.id is null then
    raise exception using
      errcode = 'P0002',
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
    raise exception using
      errcode = 'P0002',
      message = 'financial_transaction_not_found';
  end if;

  select occurrence.*
  into existing_occurrence
  from public.financial_commitment_occurrences occurrence
  where occurrence.workspace_id = p_workspace_id
    and occurrence.linked_transaction_id = p_transaction_id
  for update;

  if existing_occurrence.id = target_occurrence.id then
    return query
      select
        'already_linked'::text,
        existing_occurrence.id,
        existing_occurrence.commitment_id,
        commitment.title
      from public.financial_commitments commitment
      where commitment.id = existing_occurrence.commitment_id;
    return;
  end if;

  if target_occurrence.linked_transaction_id is not null then
    raise exception using
      errcode = '23505',
      message = 'target_occurrence_already_linked';
  end if;

  if existing_occurrence.id is not null and not p_replace_existing then
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

  if existing_occurrence.id is not null then
    restored_status := case
      when existing_occurrence.linked_card_movement_id is not null
        then existing_occurrence.status
      when existing_occurrence.status in ('cancelled', 'skipped', 'disputed')
        then existing_occurrence.status
      when existing_occurrence.expected_due_date < today_in_brasilia
        then 'overdue'
      when date_trunc('month', existing_occurrence.expected_due_date)
        = date_trunc('month', today_in_brasilia)
        then 'pending'
      else 'projected'
    end;

    update public.financial_commitment_occurrences occurrence
    set
      linked_transaction_id = null,
      actual_amount = case
        when occurrence.linked_card_movement_id is null then null
        else occurrence.actual_amount
      end,
      payment_date = case
        when occurrence.linked_card_movement_id is null then null
        else occurrence.payment_date
      end,
      status = restored_status,
      manually_confirmed = occurrence.linked_card_movement_id is not null,
      match_source = case
        when occurrence.linked_card_movement_id is null then null
        else occurrence.match_source
      end,
      match_confidence = case
        when occurrence.linked_card_movement_id is null then null
        else occurrence.match_confidence
      end,
      updated_at = now()
    where occurrence.id = existing_occurrence.id
      and occurrence.workspace_id = p_workspace_id
      and occurrence.linked_transaction_id = p_transaction_id;
  end if;

  target_status := case
    when target_occurrence.status in ('cancelled', 'skipped', 'disputed')
      then target_occurrence.status
    when abs(movement.amount) + 0.01 < coalesce(target_occurrence.expected_amount, 0)
      then 'partially_paid'
    else 'paid'
  end;

  update public.financial_commitment_occurrences occurrence
  set
    linked_transaction_id = p_transaction_id,
    actual_amount = abs(movement.amount),
    payment_date = movement.competence_date,
    status = target_status,
    manually_confirmed = true,
    match_source = 'manual',
    match_confidence = 1,
    updated_at = now()
  where occurrence.id = target_occurrence.id
    and occurrence.workspace_id = p_workspace_id;

  if existing_occurrence.id is null then
    return query
      select 'linked'::text, null::uuid, null::uuid, null::text;
  else
    return query
      select
        'replaced'::text,
        existing_occurrence.id,
        existing_occurrence.commitment_id,
        commitment.title
      from public.financial_commitments commitment
      where commitment.id = existing_occurrence.commitment_id;
  end if;
end;
$$;

revoke all on function public.link_financial_transaction_to_occurrence(
  uuid,
  uuid,
  uuid,
  boolean
) from public;
grant execute on function public.link_financial_transaction_to_occurrence(
  uuid,
  uuid,
  uuid,
  boolean
) to authenticated;

commit;
