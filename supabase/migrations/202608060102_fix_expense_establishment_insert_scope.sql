begin;

create or replace function public.validate_expense_establishment_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare target_workspace uuid; source_owner uuid;
begin
  if tg_table_name = 'expense_establishments' then
    if not public.can_edit_workspace(new.workspace_id) then
      raise exception 'expense establishment write access denied';
    end if;
    target_workspace := new.workspace_id;
  elsif tg_table_name = 'expense_establishment_rules' then
    if not public.can_edit_workspace(new.workspace_id) then
      raise exception 'expense establishment write access denied';
    end if;
    select workspace_id into target_workspace from public.expense_establishments
    where id = new.establishment_id and status = 'active';
  elsif tg_table_name = 'expense_establishment_transactions' then
    select workspace_id into target_workspace from public.expense_establishments
    where id = new.establishment_id and status = 'active';
    if target_workspace is distinct from new.workspace_id then
      raise exception 'expense establishment workspace mismatch';
    end if;
    if new.transaction_id is not null then
      select workspace_id, owner_id into target_workspace, source_owner from public.financial_transactions where id = new.transaction_id;
    elsif new.card_purchase_id is not null then
      select workspace_id, owner_id into target_workspace, source_owner from public.card_purchases where id = new.card_purchase_id;
    else
      select workspace_id, owner_id into target_workspace, source_owner from public.invoice_entries where id = new.invoice_entry_id;
    end if;
    if target_workspace is null then
      select id into target_workspace from public.workspaces where id = new.workspace_id and owner_id = source_owner;
    end if;
    if new.created_by is not null and (new.created_by <> auth.uid() or not public.can_edit_workspace(new.workspace_id)) then
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

commit;
