-- A lower Pluggy Bill must not erase a newer reliable open-statement snapshot
-- while another product in the same synchronization is unavailable.

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
  partial_bank_reduction boolean;
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
  baseline=greatest(
    case when tg_op='UPDATE' then old.last_reliable_invoice_total end,
    case when tg_op='UPDATE' then old.current_display_total end,
    new.last_reliable_invoice_total,
    new.current_display_total
  );
  legitimate_reduction=coalesce(new.value_change_reason,'unknown') in (
    'transaction_updated','transaction_deleted','bank_total_changed',
    'credit_received','refund_received','manual_adjustment','complete_resync'
  );
  partial_bank_reduction=new.data_completeness='partial'
    and bank_total is not null
    and baseline is not null
    and bank_total<baseline;

  if new.status='open' then
    if partial_bank_reduction then
      new.current_display_total=baseline;
      new.last_reliable_invoice_total=baseline;
      new.value_change_reason='partial_sync_preserved';
      new.value_change_source='reconciliation';
      new.preservation_reason=coalesce(
        new.preservation_reason,
        'partial_bill_lower_than_reliable_snapshot'
      );
    elsif bank_total is not null then
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
        and new.calculated_invoice_total>baseline then
        new.current_display_total=new.calculated_invoice_total;
      elsif new.calculated_invoice_total is not null
        and new.calculated_invoice_total<baseline
        and legitimate_reduction then
        new.current_display_total=new.calculated_invoice_total;
        new.last_reliable_invoice_total=new.calculated_invoice_total;
        new.last_reliable_snapshot_at=coalesce(
          new.last_reliable_snapshot_at,now()
        );
      else
        new.current_display_total=baseline;
        new.last_reliable_invoice_total=baseline;
        if new.calculated_invoice_total is not null
          and new.calculated_invoice_total<baseline then
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

-- Restore the value that was visible immediately before a lower Bill was
-- accepted during the currently partial connection state.
with latest_decrease as (
  select distinct on (history.statement_id)
    history.statement_id,
    history.previous_display_total_amount
  from public.credit_card_statement_value_history history
  join public.card_invoices invoice on invoice.id=history.statement_id
  join public.credit_cards card on card.id=invoice.card_id
  join public.bank_connections connection on connection.id=card.bank_connection_id
  where invoice.status='open'
    and connection.data_completeness='partial'
    and history.change_direction='decrease'
    and history.change_reason='bank_total_changed'
    and history.previous_display_total_amount>history.new_display_total_amount
    and history.created_at>=coalesce(
      connection.stale_since-interval '5 minutes',
      now()-interval '1 day'
    )
  order by history.statement_id,history.created_at desc
)
update public.card_invoices invoice
set
  data_completeness='partial',
  current_display_total=greatest(
    invoice.current_display_total,
    latest_decrease.previous_display_total_amount
  ),
  last_reliable_invoice_total=greatest(
    invoice.last_reliable_invoice_total,
    latest_decrease.previous_display_total_amount
  ),
  preservation_reason='partial_bill_lower_than_reliable_snapshot',
  value_change_reason='partial_sync_preserved',
  value_change_source='recovery',
  updated_at=now()
from latest_decrease
where invoice.id=latest_decrease.statement_id;

comment on function public.resolve_open_card_invoice_display_total() is
  'Stores Pluggy Bill totals but preserves a higher reliable open-statement snapshot during partial synchronization.';
