begin;

create or replace function public.validate_person_reimbursement_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  person_workspace uuid;
  source_workspace uuid;
  source_owner uuid;
  source_visibility text;
  source_direction text;
  reimbursement_workspace uuid;
  allocation_workspace uuid;
begin
  if tg_table_name = 'reimbursement_allocations' then
    select workspace_id into reimbursement_workspace
      from public.financial_reimbursements where id = new.reimbursement_id;
    select workspace_id into allocation_workspace
      from public.expense_allocations where id = new.expense_allocation_id;
    if reimbursement_workspace is null or allocation_workspace is null
      or reimbursement_workspace <> new.workspace_id
      or allocation_workspace <> new.workspace_id then
      raise exception 'reimbursement allocation workspace mismatch';
    end if;
    return new;
  end if;

  select workspace_id into person_workspace
    from public.financial_people where id = new.person_id and archived_at is null;
  if person_workspace is null or person_workspace <> new.workspace_id then
    raise exception 'person workspace mismatch';
  end if;
  if (tg_op = 'INSERT' and new.created_by <> auth.uid())
    or not public.can_edit_workspace(new.workspace_id) then
    raise exception 'person finance write access denied';
  end if;

  if tg_table_name = 'expense_allocations' then
    if new.source_transaction_id is not null then
      select workspace_id, owner_id, visibility into
        source_workspace, source_owner, source_visibility
      from public.financial_transactions where id = new.source_transaction_id;
    elsif new.source_card_movement_id is not null then
      select workspace_id, owner_id, visibility into
        source_workspace, source_owner, source_visibility
      from public.card_purchases where id = new.source_card_movement_id;
    elsif new.source_commitment_occurrence_id is not null then
      select workspace_id into source_workspace
      from public.financial_commitment_occurrences
      where id = new.source_commitment_occurrence_id;
    end if;
    if new.source_type <> 'manual_expense'
      and source_workspace is distinct from new.workspace_id
      and not (source_workspace is null and source_owner = auth.uid()) then
      raise exception 'expense source workspace mismatch';
    end if;
  end if;

  if tg_table_name = 'financial_reimbursements' then
    if new.incoming_transaction_id is not null then
      select workspace_id, owner_id, visibility, bank_direction into
        source_workspace, source_owner, source_visibility, source_direction
      from public.financial_transactions where id = new.incoming_transaction_id;
      if (source_workspace is distinct from new.workspace_id
          and not (source_workspace is null and source_owner = auth.uid()))
        or source_direction <> 'inflow' then
        raise exception 'reimbursement requires an incoming transaction in the workspace';
      end if;
    end if;
  end if;
  return new;
end $$;

commit;
