-- A reference rule may require both the origin and exact amount, or only
-- the origin when an income varies from month to month.
alter table public.financial_commitments
  add column if not exists auto_match_amount_exact boolean not null default true;

create or replace function public.auto_match_exact_income_reference()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target record;
begin
  if new.bank_direction <> 'inflow' or new.status <> 'realized' then return new; end if;
  select c.id as commitment_id, o.id as occurrence_id
    into target
  from financial_commitments c
  join financial_commitment_occurrences o on o.commitment_id = c.id
  where c.workspace_id = new.workspace_id
    and c.cash_flow_direction = 'income'
    and c.auto_match_enabled
    and c.account_id = new.account_id
    and (not c.auto_match_amount_exact or c.expected_amount = abs(new.amount))
    and new.description ilike '%' || c.merchant_match_pattern || '%'
    and o.competence_month = date_trunc('month', new.competence_date)::date
    and o.linked_transaction_id is null
    and o.status in ('projected','expected','pending','overdue')
  limit 1;
  if target.occurrence_id is null then return new; end if;
  insert into financial_occurrence_transactions(workspace_id,occurrence_id,transaction_id,allocated_amount,link_source,confidence,manually_confirmed,created_by)
  values (new.workspace_id,target.occurrence_id,new.id,abs(new.amount),'automatic_sync',1,false,new.owner_id)
  on conflict do nothing;
  update financial_commitment_occurrences set actual_amount=abs(new.amount),received_amount=abs(new.amount),status='received',payment_date=new.competence_date,linked_transaction_id=new.id,match_confidence=1,match_source='automatic_reference',updated_at=now()
  where id=target.occurrence_id;
  return new;
end $$;
