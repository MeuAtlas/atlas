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
        and (
          transaction.owner_id = auth.uid()
          or (
            auth.role() = 'service_role'
            and transaction.owner_id = target_occurrence.created_by
          )
        )
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

notify pgrst, 'reload schema';

commit;
