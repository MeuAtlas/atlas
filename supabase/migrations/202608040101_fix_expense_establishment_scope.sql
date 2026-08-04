begin;

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
  else
    if not public.can_edit_workspace(new.workspace_id) then
      raise exception 'expense establishment write access denied';
    end if;
    target_workspace := new.workspace_id;
  end if;
  if target_workspace is distinct from new.workspace_id then
    raise exception 'expense establishment workspace mismatch';
  end if;
  return new;
end $$;

commit;
