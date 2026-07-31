-- Closed Pluggy Bills remain historical facts. For an open invoice, the Atlas
-- displays the greater of the user-confirmed bank value and the synchronized
-- transaction estimate until an official Bill for that same cycle is present.

create or replace function public.resolve_open_card_invoice_display_total()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  informed_or_estimated numeric(15,2);
begin
  if new.status='open' then
    informed_or_estimated=greatest(
      new.confirmed_open_total,
      new.manual_invoice_total,
      new.confirmed_invoice_total,
      new.calculated_invoice_total
    );

    new.current_display_total=case
      when new.source='pluggy_bill'
        and new.total_source='provider_bill'
        and new.provider_bill_id is not null
        and new.provider_invoice_total is not null
      then new.provider_invoice_total
      else coalesce(
        informed_or_estimated,
        new.last_reliable_invoice_total
      )
    end;
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_resolve_open_total
  on public.card_invoices;
create trigger card_invoices_resolve_open_total
before insert or update on public.card_invoices
for each row execute function public.resolve_open_card_invoice_display_total();

-- Re-evaluate existing open rows with the new policy.
update public.card_invoices
set current_display_total=current_display_total
where status='open';

comment on function public.resolve_open_card_invoice_display_total() is
  'Official same-cycle Bill wins; otherwise displays the greatest manual confirmation or synchronized estimate for an open invoice.';
