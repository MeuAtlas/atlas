-- Stable, evidence-aware open statement totals and an auditable value history.

alter table public.card_invoices
  add column if not exists sync_status text not null default 'stale',
  add column if not exists last_sync_attempt_at timestamptz,
  add column if not exists last_successful_sync_at timestamptz,
  add column if not exists last_bank_total_updated_at timestamptz,
  add column if not exists last_calculation_updated_at timestamptz,
  add column if not exists last_reliable_snapshot_at timestamptz,
  add column if not exists last_remote_updated_at timestamptz,
  add column if not exists last_transaction_count integer,
  add column if not exists last_complete_transaction_count integer,
  add column if not exists last_partial_transaction_count integer,
  add column if not exists personal_share_amount numeric(15,2),
  add column if not exists third_party_share_amount numeric(15,2),
  add column if not exists value_change_amount numeric(15,2),
  add column if not exists value_change_reason text,
  add column if not exists value_change_source text,
  add column if not exists sync_execution_id uuid;

alter table public.card_invoices
  drop constraint if exists card_invoices_sync_status_check;
alter table public.card_invoices
  add constraint card_invoices_sync_status_check
  check (sync_status in ('updated','partially_updated','stale','syncing','error'));

create index if not exists card_invoices_provider_account_due_idx
  on public.card_invoices(provider_account_id,due_date desc);
create index if not exists card_invoices_provider_bill_idx
  on public.card_invoices(provider_bill_id)
  where provider_bill_id is not null;
create index if not exists card_invoices_workspace_due_idx
  on public.card_invoices(workspace_id,due_date desc);

create table if not exists public.credit_card_statement_value_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  statement_id uuid not null references public.card_invoices(id) on delete cascade,
  previous_bank_total_amount numeric(15,2),
  new_bank_total_amount numeric(15,2),
  previous_calculated_total_amount numeric(15,2),
  new_calculated_total_amount numeric(15,2),
  previous_display_total_amount numeric(15,2),
  new_display_total_amount numeric(15,2),
  change_amount numeric(15,2) not null default 0,
  change_direction text not null,
  change_reason text not null,
  change_source text not null,
  sync_execution_id uuid,
  remote_updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint statement_value_history_direction_check
    check (change_direction in ('increase','decrease','unchanged')),
  constraint statement_value_history_reason_check
    check (change_reason in ('new_transaction','transaction_updated',
      'transaction_deleted','bank_total_changed','credit_received',
      'refund_received','manual_adjustment','complete_resync',
      'partial_sync_preserved','cache_refresh','unknown')),
  constraint statement_value_history_source_check
    check (change_source in ('pluggy_bill','transactions_created',
      'transactions_updated','transactions_deleted','manual',
      'reconciliation','recovery'))
);

create index if not exists statement_value_history_statement_created_idx
  on public.credit_card_statement_value_history(statement_id,created_at desc);
create index if not exists statement_value_history_workspace_created_idx
  on public.credit_card_statement_value_history(workspace_id,created_at desc);

alter table public.credit_card_statement_value_history enable row level security;
drop policy if exists statement_value_history_read
  on public.credit_card_statement_value_history;
create policy statement_value_history_read
  on public.credit_card_statement_value_history for select to authenticated
  using (exists (
    select 1 from public.card_invoices invoice
    where invoice.id=statement_id
      and public.can_read_finance(
        invoice.owner_id,invoice.workspace_id,invoice.visibility
      )
  ));
grant select on public.credit_card_statement_value_history to authenticated;

-- The old preservation trigger protected only zeroes and conflicted with the
-- display resolver. One central trigger now owns the value policy.
drop trigger if exists card_invoices_preserve_reliable on public.card_invoices;

create or replace function public.resolve_open_card_invoice_display_total()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  bank_total numeric(15,2);
  manual_total numeric(15,2);
  baseline numeric(15,2);
  legitimate_reduction boolean;
begin
  bank_total=case
    when new.source='pluggy_bill'
      and new.total_source='provider_bill'
      and new.provider_bill_id is not null
    then new.provider_invoice_total
    else null
  end;
  manual_total=coalesce(
    new.confirmed_open_total,
    new.manual_invoice_total,
    new.confirmed_invoice_total
  );
  baseline=coalesce(
    case when tg_op='UPDATE' then old.last_reliable_invoice_total end,
    case when tg_op='UPDATE' then old.current_display_total end,
    new.last_reliable_invoice_total,
    new.current_display_total
  );
  legitimate_reduction=coalesce(new.value_change_reason,'unknown') in (
    'transaction_updated','transaction_deleted','bank_total_changed',
    'credit_received','refund_received','manual_adjustment','complete_resync'
  );

  if new.status='open' then
    if bank_total is not null then
      new.current_display_total=bank_total;
      new.last_reliable_invoice_total=bank_total;
      new.last_bank_total_updated_at=coalesce(
        new.provider_updated_at,new.last_bank_total_updated_at,now()
      );
      if baseline is distinct from bank_total then
        new.value_change_reason='bank_total_changed';
        new.value_change_source='pluggy_bill';
      end if;
    elsif manual_total is not null then
      new.current_display_total=manual_total;
      new.last_reliable_invoice_total=manual_total;
    elsif new.data_completeness='complete'
      and new.calculated_invoice_total is not null then
      new.current_display_total=new.calculated_invoice_total;
      new.last_reliable_invoice_total=new.calculated_invoice_total;
      new.last_reliable_snapshot_at=coalesce(
        new.last_reliable_snapshot_at,new.last_complete_sync_at,now()
      );
    elsif baseline is not null then
      if new.calculated_invoice_total is not null
        and new.calculated_invoice_total > baseline then
        new.current_display_total=new.calculated_invoice_total;
      elsif new.calculated_invoice_total is not null
        and new.calculated_invoice_total < baseline
        and legitimate_reduction then
        new.current_display_total=new.calculated_invoice_total;
        new.last_reliable_invoice_total=new.calculated_invoice_total;
        new.last_reliable_snapshot_at=coalesce(
          new.last_reliable_snapshot_at,now()
        );
      else
        new.current_display_total=baseline;
        new.last_reliable_invoice_total=coalesce(
          case when tg_op='UPDATE' then old.last_reliable_invoice_total end,
          new.last_reliable_invoice_total,
          baseline
        );
        if new.calculated_invoice_total is not null
          and new.calculated_invoice_total < baseline then
          new.value_change_reason='partial_sync_preserved';
          new.value_change_source=coalesce(
            new.value_change_source,'reconciliation'
          );
          new.preservation_reason=coalesce(
            new.preservation_reason,'partial_sync_lower_total_preserved'
          );
        end if;
      end if;
    else
      new.current_display_total=new.calculated_invoice_total;
    end if;
  end if;

  if tg_op='UPDATE' then
    new.value_change_amount=round(
      coalesce(new.current_display_total,0)-
      coalesce(old.current_display_total,0),2
    );
  else
    new.value_change_amount=coalesce(new.current_display_total,0);
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_resolve_open_total
  on public.card_invoices;
create trigger card_invoices_resolve_open_total
before insert or update on public.card_invoices
for each row execute function public.resolve_open_card_invoice_display_total();

create or replace function public.audit_card_invoice_value_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  delta numeric(15,2);
begin
  delta=round(
    coalesce(new.current_display_total,0)-
    coalesce(old.current_display_total,0),2
  );
  if old.provider_invoice_total is distinct from new.provider_invoice_total
    or old.calculated_invoice_total is distinct from new.calculated_invoice_total
    or old.current_display_total is distinct from new.current_display_total
    or new.value_change_reason='partial_sync_preserved' then
    insert into public.credit_card_statement_value_history(
      owner_id,workspace_id,statement_id,
      previous_bank_total_amount,new_bank_total_amount,
      previous_calculated_total_amount,new_calculated_total_amount,
      previous_display_total_amount,new_display_total_amount,
      change_amount,change_direction,change_reason,change_source,
      sync_execution_id,remote_updated_at
    ) values (
      new.owner_id,new.workspace_id,new.id,
      old.provider_invoice_total,new.provider_invoice_total,
      old.calculated_invoice_total,new.calculated_invoice_total,
      old.current_display_total,new.current_display_total,
      delta,
      case when delta>0 then 'increase'
        when delta<0 then 'decrease' else 'unchanged' end,
      coalesce(new.value_change_reason,'unknown'),
      coalesce(new.value_change_source,'reconciliation'),
      new.sync_execution_id,new.last_remote_updated_at
    );
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_audit_value_change
  on public.card_invoices;
create trigger card_invoices_audit_value_change
after update on public.card_invoices
for each row execute function public.audit_card_invoice_value_change();

-- Backfill without ever lowering the amount already shown.
update public.card_invoices
set
  last_reliable_invoice_total=greatest(
    coalesce(last_reliable_invoice_total,0),
    coalesce(current_display_total,0),
    coalesce(provider_invoice_total,0),
    coalesce(manual_invoice_total,0),
    coalesce(confirmed_invoice_total,0),
    coalesce(calculated_invoice_total,0)
  ),
  current_display_total=greatest(
    coalesce(current_display_total,0),
    coalesce(last_reliable_invoice_total,0),
    coalesce(provider_invoice_total,0),
    coalesce(manual_invoice_total,0),
    coalesce(confirmed_invoice_total,0),
    coalesce(calculated_invoice_total,0)
  ),
  last_sync_attempt_at=coalesce(last_sync_attempt_at,last_sync_at,updated_at),
  last_successful_sync_at=coalesce(
    last_successful_sync_at,last_complete_sync_at,last_sync_at,updated_at
  ),
  last_reliable_snapshot_at=coalesce(
    last_reliable_snapshot_at,last_complete_sync_at,last_sync_at,updated_at
  ),
  last_transaction_count=coalesce(last_transaction_count,purchase_count),
  last_complete_transaction_count=coalesce(
    last_complete_transaction_count,last_reliable_purchase_count,purchase_count
  );

comment on function public.resolve_open_card_invoice_display_total() is
  'Official Bill wins; complete sums replace snapshots; partial sums can increase but only evidence-backed reductions can lower the displayed statement total.';
