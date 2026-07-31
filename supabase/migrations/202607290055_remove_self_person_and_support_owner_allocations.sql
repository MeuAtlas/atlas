begin;

-- O titular do workspace é implícito. Pessoas representam somente terceiros.
alter table public.financial_entities
  add column if not exists is_internal boolean not null default false,
  add column if not exists internal_kind text;

alter table public.financial_entities
  drop constraint if exists financial_entities_internal_kind_check,
  add constraint financial_entities_internal_kind_check check (
    (not is_internal and internal_kind is null)
    or (is_internal and internal_kind in ('person_matching'))
  );

alter table public.transaction_people
  add column if not exists match_confidence numeric(5,4) not null default 1,
  add column if not exists association_scope text not null default 'current';

alter table public.transaction_people
  drop constraint if exists transaction_people_match_confidence_check,
  add constraint transaction_people_match_confidence_check
    check (match_confidence between 0 and 1),
  drop constraint if exists transaction_people_association_scope_check,
  add constraint transaction_people_association_scope_check
    check (association_scope in ('current','similar'));

drop trigger if exists expense_allocations_validate_scope
  on public.expense_allocations;

alter table public.expense_allocations
  alter column person_id drop not null,
  add column if not exists responsible_party_type text not null default 'person';

alter table public.expense_allocations
  drop constraint if exists expense_allocations_responsible_party_check,
  add constraint expense_allocations_responsible_party_check check (
    (responsible_party_type = 'owner' and person_id is null)
    or (responsible_party_type = 'person' and person_id is not null)
  );

-- Migra a responsabilidade do antigo "Eu" sem alterar valores históricos.
update public.expense_allocations allocation
set person_id = null,
    responsible_party_type = 'owner',
    updated_at = now()
from public.financial_people person
where allocation.person_id = person.id
  and person.relation_type = 'self';

delete from public.transaction_people link
using public.financial_people person
where link.person_id = person.id
  and person.relation_type = 'self';

delete from public.commitment_people link
using public.financial_people person
where link.person_id = person.id
  and person.relation_type = 'self';

update public.financial_classification_rules rule
set linked_person_id = null,
    updated_at = now()
from public.financial_people person
where rule.linked_person_id = person.id
  and person.relation_type = 'self';

update public.financial_entities entity
set linked_person_id = null,
    updated_at = now()
from public.financial_people person
where entity.linked_person_id = person.id
  and person.relation_type = 'self';

update public.person_counterparties counterparty
set is_active = false,
    archived_at = coalesce(counterparty.archived_at, now()),
    updated_at = now()
from public.financial_people person
where counterparty.person_id = person.id
  and person.relation_type = 'self';

update public.person_transaction_match_suggestions suggestion
set status = case when suggestion.status = 'pending' then 'expired'
                  else suggestion.status end,
    reviewed_at = coalesce(suggestion.reviewed_at, now())
from public.financial_people person
where suggestion.person_id = person.id
  and person.relation_type = 'self';

update public.financial_people
set is_active = false,
    archived_at = coalesce(archived_at, now()),
    updated_at = now()
where relation_type = 'self';

drop index if exists public.financial_people_one_self_per_workspace_idx;
create unique index if not exists financial_people_no_active_self_guard
  on public.financial_people(workspace_id)
  where relation_type = 'self' and archived_at is null;

alter table public.financial_people
  drop constraint if exists financial_people_no_active_self_check,
  add constraint financial_people_no_active_self_check
    check (relation_type <> 'self' or archived_at is not null);

drop index if exists public.expense_allocations_source_person_role_idx;
create unique index expense_allocations_source_party_role_idx
  on public.expense_allocations (
    workspace_id,
    source_type,
    coalesce(source_transaction_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_card_movement_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_invoice_entry_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_commitment_occurrence_id, '00000000-0000-0000-0000-000000000000'::uuid),
    responsible_party_type,
    coalesce(person_id, '00000000-0000-0000-0000-000000000000'::uuid),
    allocation_role
  )
  where archived_at is null and source_type <> 'manual_expense';

create index if not exists expense_allocations_workspace_owner_idx
  on public.expense_allocations(workspace_id, status)
  where responsible_party_type = 'owner' and archived_at is null;

-- Entidades silenciosas usadas pelo matching de pessoa não poluem a área avançada.
update public.financial_entities
set is_internal = true,
    internal_kind = 'person_matching',
    updated_at = now()
where linked_person_id is not null
  and notes = 'Entidade interna criada pelo vínculo simplificado de pessoa.';

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

  if tg_table_name <> 'expense_allocations'
    or new.responsible_party_type <> 'owner' then
    select workspace_id into person_workspace
      from public.financial_people
      where id = new.person_id and archived_at is null
        and relation_type <> 'self';
    if person_workspace is null or person_workspace <> new.workspace_id then
      raise exception 'person workspace mismatch';
    end if;
  elsif new.person_id is not null then
    raise exception 'owner allocation cannot reference a person';
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
  elsif tg_table_name = 'financial_reimbursements'
    and new.incoming_transaction_id is not null then
    select workspace_id, owner_id, visibility, bank_direction into
      source_workspace, source_owner, source_visibility, source_direction
    from public.financial_transactions where id = new.incoming_transaction_id;
    if (source_workspace is distinct from new.workspace_id
        and not (source_workspace is null and source_owner = auth.uid()))
      or source_direction <> 'inflow' then
      raise exception 'reimbursement requires an incoming transaction in the workspace';
    end if;
  end if;
  return new;
end $$;

create trigger expense_allocations_validate_scope
before insert or update on public.expense_allocations
for each row execute function public.validate_person_reimbursement_scope();

create or replace function public.create_shared_occurrence_allocations()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  commitment_row public.financial_commitments%rowtype;
  gross numeric(15,2);
  user_amount numeric(15,2);
  other_amount numeric(15,2);
begin
  select * into commitment_row from public.financial_commitments
  where id = new.commitment_id;
  if not commitment_row.shared_expense_enabled then return new; end if;
  gross := coalesce(new.actual_amount, new.expected_amount, commitment_row.expected_amount, 0);
  user_amount := case commitment_row.user_responsibility_type
    when 'full' then gross
    when 'percentage' then round(gross * commitment_row.user_responsibility_value / 100, 2)
    else least(commitment_row.user_responsibility_value, gross)
  end;
  other_amount := case commitment_row.reimbursement_allocation_type
    when 'full' then gross
    when 'percentage' then round(gross * commitment_row.reimbursement_allocation_value / 100, 2)
    when 'fixed_amount' then least(commitment_row.reimbursement_allocation_value, gross)
    else greatest(gross - user_amount, 0)
  end;

  insert into public.expense_allocations (
    workspace_id, source_type, source_commitment_occurrence_id, person_id,
    responsible_party_type, allocation_role, allocation_type, allocation_value,
    allocated_amount, reimbursable_amount, pending_reimbursement_amount, status,
    manually_confirmed, created_by
  ) values
  (new.workspace_id, 'commitment_occurrence', new.id,
    commitment_row.beneficiary_person_id, 'person', 'beneficiary', 'full', 100,
    gross, 0, 0, 'active', true, new.created_by),
  (new.workspace_id, 'commitment_occurrence', new.id,
    null, 'owner', 'responsible_party',
    commitment_row.user_responsibility_type,
    commitment_row.user_responsibility_value, user_amount, 0, 0,
    'active', true, new.created_by),
  (new.workspace_id, 'commitment_occurrence', new.id,
    commitment_row.reimbursement_person_id, 'person', 'shared_responsibility',
    commitment_row.reimbursement_allocation_type,
    commitment_row.reimbursement_allocation_value, other_amount, other_amount,
    other_amount, case when other_amount > 0 then 'pending' else 'active' end,
    true, new.created_by)
  on conflict do nothing;
  return new;
end $$;

commit;
