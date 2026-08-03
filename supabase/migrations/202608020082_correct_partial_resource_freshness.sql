begin;

create or replace function public.preserve_partial_resource_success_timestamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'succeeded' or new.sync_completeness <> 'complete' then
    select prior.last_successful_sync_at into new.last_successful_sync_at
    from public.financial_resource_sync_status prior
    where prior.bank_connection_id = new.bank_connection_id
      and prior.resource_type = new.resource_type
      and prior.provider_entity_id = new.provider_entity_id
      and prior.id <> new.id
      and prior.status = 'succeeded'
      and prior.sync_completeness = 'complete'
      and prior.records_received > 0
    order by prior.created_at desc
    limit 1;
  end if;
  return new;
end
$$;

drop trigger if exists preserve_partial_resource_success_timestamp
  on public.financial_resource_sync_status;
create trigger preserve_partial_resource_success_timestamp
before insert or update of status, sync_completeness, last_successful_sync_at
on public.financial_resource_sync_status
for each row execute function public.preserve_partial_resource_success_timestamp();

update public.financial_resource_sync_status current_status
set last_successful_sync_at = (
  select candidate.last_successful_sync_at
  from public.financial_resource_sync_status candidate
  where candidate.bank_connection_id = current_status.bank_connection_id
    and candidate.resource_type = current_status.resource_type
    and candidate.provider_entity_id = current_status.provider_entity_id
    and candidate.created_at < current_status.created_at
    and candidate.status = 'succeeded'
    and candidate.sync_completeness = 'complete'
    and candidate.records_received > 0
  order by candidate.created_at desc
  limit 1
)
where current_status.resource_type = 'transactions'
  and (
    current_status.sync_completeness = 'partial'
    or current_status.status <> 'succeeded'
    or current_status.records_received = 0
  );

update public.financial_accounts account
set last_transaction_date = latest.last_transaction_date
from (
  select transaction.account_id, max(transaction.competence_date) as last_transaction_date
  from public.financial_transactions transaction
  where transaction.source = 'pluggy'
    and not transaction.is_provider_deleted
  group by transaction.account_id
) latest
where latest.account_id = account.id and account.source = 'pluggy';

update public.financial_accounts account
set last_transactions_sync_at = (
  select status.last_successful_sync_at
  from public.financial_resource_sync_status status
  where status.bank_connection_id = account.bank_connection_id
    and status.resource_type = 'transactions'
    and status.provider_entity_id = account.external_id
    and status.status = 'succeeded'
    and status.sync_completeness = 'complete'
    and status.records_received > 0
  order by status.created_at desc
  limit 1
)
where account.source = 'pluggy';

notify pgrst, 'reload schema';
commit;
