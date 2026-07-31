-- Impede vínculos cruzados entre workspaces e preserva o autor em updates.
create or replace function public.validate_commitment_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  parent_workspace uuid;
  person_workspace uuid;
begin
  if tg_op = 'INSERT' and new.created_by <> auth.uid() then
    raise exception 'invalid commitment owner';
  end if;
  if tg_op = 'UPDATE' and new.created_by <> old.created_by then
    raise exception 'commitment owner cannot change';
  end if;
  if not public.can_write_finance(new.created_by, new.workspace_id, 'workspace') then
    raise exception 'commitment workspace access denied';
  end if;
  if tg_table_name in (
    'financial_commitment_occurrences',
    'commitment_people',
    'commitment_match_rules'
  ) then
    select workspace_id into parent_workspace
    from public.financial_commitments where id = new.commitment_id;
    if parent_workspace is null or parent_workspace <> new.workspace_id then
      raise exception 'commitment workspace mismatch';
    end if;
  end if;
  if tg_table_name = 'commitment_people' then
    select workspace_id into person_workspace
    from public.financial_people where id = new.person_id;
    if person_workspace is null or person_workspace <> new.workspace_id then
      raise exception 'person workspace mismatch';
    end if;
  end if;
  return new;
end $$;

create or replace function public.validate_transaction_person_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  transaction_workspace uuid;
  transaction_owner uuid;
  transaction_visibility text;
  person_workspace uuid;
begin
  select workspace_id, owner_id, visibility
    into transaction_workspace, transaction_owner, transaction_visibility
  from public.financial_transactions where id = new.transaction_id;
  select workspace_id into person_workspace
  from public.financial_people where id = new.person_id;
  if transaction_owner is null
    or not public.can_write_finance(
      transaction_owner,
      transaction_workspace,
      transaction_visibility
    )
    or person_workspace is null
    or person_workspace <> new.workspace_id
    or (
      transaction_workspace is not null
      and transaction_workspace <> new.workspace_id
    )
    or (tg_op = 'INSERT' and new.created_by <> auth.uid())
    or (tg_op = 'UPDATE' and new.created_by <> old.created_by)
  then
    raise exception 'transaction allocation access denied';
  end if;
  return new;
end $$;
