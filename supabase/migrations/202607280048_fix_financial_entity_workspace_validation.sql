begin;

create or replace function public.validate_financial_entity_scope()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  related_workspace uuid;
  related_owner uuid;
begin
  if auth.role() <> 'service_role'
     and not public.can_edit_workspace(new.workspace_id) then
    raise exception 'financial entity write access denied';
  end if;

  if tg_table_name = 'financial_entities' then
    if new.default_category_id is not null then
      related_owner := null;
      select owner_id into related_owner
      from public.financial_categories
      where id = new.default_category_id and is_active = true;
      if not found
         or (related_owner is not null and related_owner is distinct from new.created_by) then
        raise exception 'financial entity category workspace mismatch';
      end if;
    end if;

    if new.default_group_id is not null then
      related_workspace := null;
      select workspace_id into related_workspace
      from public.financial_analysis_groups
      where id = new.default_group_id
        and is_active = true
        and archived_at is null;
      if not found or related_workspace is distinct from new.workspace_id then
        raise exception 'financial entity group workspace mismatch';
      end if;
    end if;

    if new.linked_person_id is not null then
      related_workspace := null;
      select workspace_id into related_workspace
      from public.financial_people
      where id = new.linked_person_id
        and is_active = true
        and archived_at is null;
      if not found or related_workspace is distinct from new.workspace_id then
        raise exception 'financial entity person workspace mismatch';
      end if;
    end if;

    return new;
  end if;

  related_workspace := null;
  if tg_table_name = 'financial_entity_counterparties' then
    select workspace_id into related_workspace from public.financial_entities
      where id = new.entity_id and archived_at is null;
  elsif tg_table_name = 'financial_classification_rules' then
    if new.entity_id is not null then
      select workspace_id into related_workspace from public.financial_entities
        where id = new.entity_id and archived_at is null;
    else
      related_workspace := new.workspace_id;
    end if;
    if new.linked_person_id is not null and not exists (
      select 1 from public.financial_people
      where id = new.linked_person_id
        and workspace_id = new.workspace_id
        and is_active = true
        and archived_at is null
    ) then
      raise exception 'rule person workspace mismatch';
    end if;
  elsif tg_table_name = 'financial_rule_conditions' then
    select workspace_id into related_workspace
    from public.financial_classification_rules
    where id = new.rule_id and archived_at is null;
  elsif tg_table_name = 'transaction_entities' then
    select workspace_id into related_workspace from public.financial_entities
      where id = new.entity_id and archived_at is null;
    if related_workspace is distinct from new.workspace_id then
      raise exception 'entity link workspace mismatch';
    end if;
    if new.transaction_id is not null then
      select workspace_id into related_workspace from public.financial_transactions
        where id = new.transaction_id;
    else
      select workspace_id into related_workspace from public.card_purchases
        where id = new.card_movement_id;
    end if;
  end if;

  if related_workspace is distinct from new.workspace_id then
    raise exception 'financial entity workspace mismatch';
  end if;
  return new;
end $$;

comment on function public.validate_financial_entity_scope() is
  'Validates workspace relationships independently; system categories (owner_id null) are global.';

commit;
