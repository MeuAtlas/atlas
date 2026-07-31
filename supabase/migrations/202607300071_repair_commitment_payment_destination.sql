begin;

-- A bank statement description is the safest common identity available for
-- every provider. Account and cash-flow direction remain part of the unique
-- key, preventing the same text in another account from being mixed in.
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
  saved_id uuid;
  normalized_description text;
  conflicting_commitment_id uuid;
begin
  normalized_description :=
    public.normalize_commitment_payment_identity(p_movement.description);

  if normalized_description is null
    or char_length(normalized_description) < 3
  then
    return null;
  end if;

  select source.id, source.commitment_id
  into saved_id, conflicting_commitment_id
  from public.commitment_payment_sources source
  where source.workspace_id = p_workspace_id
    and source.identity_type = 'description'
    and source.identity_value = normalized_description
    and source.account_id is not distinct from p_movement.account_id
    and source.direction = 'outflow'
    and source.is_active
  limit 1;

  if saved_id is not null
    and conflicting_commitment_id <> p_commitment_id
  then
    -- Never let a destination silently settle two different commitments.
    return null;
  end if;

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
      'description',
      normalized_description,
      'outflow'
    )
    returning id into saved_id;
  end if;

  perform public.apply_commitment_payment_source_to_existing(saved_id);
  return saved_id;
end;
$$;

notify pgrst, 'reload schema';

commit;
