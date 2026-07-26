-- Separate the open credit-card cycle from the previously closed invoice.
-- The migration is idempotent and preserves invoice and purchase identifiers.

alter table public.card_invoices
  add column if not exists paid_at timestamptz,
  add column if not exists manual_invoice_total numeric(15,2),
  add column if not exists provider_bill_status text,
  add column if not exists minimum_payment_amount numeric(15,2);

alter table public.card_invoices drop constraint if exists card_invoices_status_check;
alter table public.card_invoices add constraint card_invoices_status_check
  check (status in (
    'open','closed','due','partially_paid','paid','overdue','cancelled','estimated'
  ));

create or replace function public.normalize_card_invoice_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if new.total_amount > 0 and new.paid_amount >= new.total_amount then
    new.status := 'paid';
  elsif new.paid_amount > 0 then
    new.status := 'partially_paid';
  elsif current_date <= new.closing_date then
    new.status := 'open';
  elsif current_date = new.due_date then
    new.status := 'due';
  elsif current_date > new.due_date then
    new.status := 'overdue';
  else
    new.status := 'closed';
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_normalize_status on public.card_invoices;
create trigger card_invoices_normalize_status
before insert or update on public.card_invoices
for each row execute function public.normalize_card_invoice_status();

with cycle_dates as (
  select
    invoice.id,
    (
      date_trunc('month', invoice.reference_month)::date
      + (
        least(
          card.closing_day,
          extract(
            day from (
              date_trunc('month', invoice.reference_month)
              + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date as closing_date,
    card.closing_day,
    card.due_day
  from public.card_invoices invoice
  join public.credit_cards card on card.id = invoice.card_id
  where card.closing_day is not null and card.due_day is not null
),
normalized as (
  select
    id,
    closing_date,
    (
      date_trunc('month', closing_date - interval '1 month')::date
      + (
        least(
          closing_day,
          extract(
            day from (
              date_trunc('month', closing_date - interval '1 month')
              + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date + 1 as cycle_start_date,
    (
      date_trunc(
        'month',
        closing_date
        + case when due_day <= closing_day then interval '1 month' else interval '0' end
      )::date
      + (
        least(
          due_day,
          extract(
            day from (
              date_trunc(
                'month',
                closing_date
                + case when due_day <= closing_day then interval '1 month' else interval '0' end
              ) + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date as due_date
  from cycle_dates
)
update public.card_invoices invoice
set
  cycle_start_date = normalized.cycle_start_date,
  cycle_end_date = normalized.closing_date,
  closing_date = normalized.closing_date,
  due_date = normalized.due_date,
  updated_at = now()
from normalized
where invoice.id = normalized.id;

with active_cards as (
  select
    card.*,
    (
      date_trunc('month', current_date)::date
      + (
        least(
          card.closing_day,
          extract(
            day from (
              date_trunc('month', current_date) + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date as this_month_closing
  from public.credit_cards card
  where card.status = 'active'
    and card.closing_day is not null
    and card.due_day is not null
),
current_closings as (
  select
    *,
    case
      when current_date <= this_month_closing then this_month_closing
      else (
        date_trunc('month', current_date + interval '1 month')::date
        + (
          least(
            closing_day,
            extract(
              day from (
                date_trunc('month', current_date + interval '1 month')
                + interval '1 month - 1 day'
              )
            )::integer
          ) - 1
        )
      )::date
    end as current_closing
  from active_cards
),
target_closings as (
  select *, current_closing as closing_date from current_closings
  union all
  select
    current_closings.*,
    (
      date_trunc('month', current_closing - interval '1 month')::date
      + (
        least(
          closing_day,
          extract(
            day from (
              date_trunc('month', current_closing - interval '1 month')
              + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date as closing_date
  from current_closings
),
rows as (
  select
    gen_random_uuid() as id,
    owner_id,
    target_closings.id as card_id,
    date_trunc('month', closing_date)::date as reference_month,
    (
      date_trunc('month', closing_date - interval '1 month')::date
      + (
        least(
          closing_day,
          extract(
            day from (
              date_trunc('month', closing_date - interval '1 month')
              + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date + 1 as cycle_start_date,
    closing_date as cycle_end_date,
    closing_date,
    (
      date_trunc(
        'month',
        closing_date
        + case when due_day <= closing_day then interval '1 month' else interval '0' end
      )::date
      + (
        least(
          due_day,
          extract(
            day from (
              date_trunc(
                'month',
                closing_date
                + case when due_day <= closing_day then interval '1 month' else interval '0' end
              ) + interval '1 month - 1 day'
            )
          )::integer
        ) - 1
      )
    )::date as due_date
  from target_closings
)
insert into public.card_invoices (
  id, owner_id, card_id, reference_month, cycle_start_date, cycle_end_date,
  closing_date, due_date, total_amount, invoice_total, outstanding_amount,
  status, source, total_source, external_id
)
select
  id, owner_id, card_id, reference_month, cycle_start_date, cycle_end_date,
  closing_date, due_date, 0, 0, 0, 'estimated', 'atlas',
  'calculated_transactions',
  'atlas:' || card_id::text || ':' || to_char(reference_month, 'YYYY-MM')
from rows
on conflict (card_id, reference_month) do nothing;

update public.card_purchases purchase
set invoice_id = (
  select invoice.id
  from public.card_invoices invoice
  where invoice.owner_id = purchase.owner_id
    and invoice.card_id = purchase.card_id
    and (
      (
        purchase.transaction_role = 'invoice_payment'
        and coalesce(
          purchase.bill_forecast_date,
          purchase.purchase_date,
          purchase.competence_date
        ) > invoice.cycle_end_date
        and coalesce(
          purchase.bill_forecast_date,
          purchase.purchase_date,
          purchase.competence_date
        ) <= invoice.due_date
      )
      or (
        purchase.transaction_role <> 'invoice_payment'
        and coalesce(
          purchase.bill_forecast_date,
          purchase.purchase_date,
          purchase.competence_date
        ) >= invoice.cycle_start_date
        and coalesce(
          purchase.bill_forecast_date,
          purchase.purchase_date,
          purchase.competence_date
        ) <= invoice.cycle_end_date
      )
    )
  order by invoice.cycle_end_date desc
  limit 1
)
where purchase.status <> 'cancelled';

with totals as (
  select
    invoice.id,
    coalesce(sum(
      case
        when purchase.transaction_role = 'consumption'
          and purchase.review_status <> 'pending'
        then abs(purchase.installment_amount)
        else 0
      end
    ), 0) as purchases_total,
    coalesce(sum(
      case when purchase.transaction_role = 'refund'
        then abs(purchase.installment_amount) else 0 end
    ), 0) as credits_total,
    coalesce(sum(
      case
        when purchase.transaction_role = 'adjustment'
          and coalesce(purchase.original_amount, -purchase.installment_amount) < 0
        then abs(purchase.installment_amount)
        else 0
      end
    ), 0) as adjustments_total,
    coalesce(sum(
      case when purchase.transaction_role = 'invoice_payment'
        then abs(purchase.installment_amount) else 0 end
    ), 0) as paid_amount,
    max(
      case when purchase.transaction_role = 'invoice_payment'
        then purchase.purchase_date::timestamptz else null end
    ) as paid_at,
    count(*) filter (
      where purchase.transaction_role = 'consumption'
        and purchase.review_status <> 'pending'
    ) as purchase_count
  from public.card_invoices invoice
  left join public.card_purchases purchase
    on purchase.invoice_id = invoice.id and purchase.status <> 'cancelled'
  group by invoice.id
),
calculated as (
  select
    *,
    greatest(0, purchases_total + adjustments_total - credits_total)
      as calculated_total
  from totals
)
update public.card_invoices invoice
set
  purchases_total = calculated.purchases_total,
  credits_total = calculated.credits_total,
  adjustments_total = calculated.adjustments_total,
  calculated_invoice_total = calculated.calculated_total,
  paid_amount = calculated.paid_amount,
  paid_at = calculated.paid_at,
  purchase_count = calculated.purchase_count,
  invoice_total = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    calculated.calculated_total
  ),
  total_amount = coalesce(
    invoice.provider_invoice_total,
    invoice.manual_invoice_total,
    calculated.calculated_total
  ),
  outstanding_amount = greatest(
    0,
    coalesce(
      invoice.provider_invoice_total,
      invoice.manual_invoice_total,
      calculated.calculated_total
    ) - calculated.paid_amount
  ),
  total_source = case
    when invoice.provider_invoice_total is not null then 'provider_bill'
    when invoice.manual_invoice_total is not null then 'manual_bank_confirmation'
    else 'calculated_transactions'
  end,
  reconciliation_difference = case
    when invoice.provider_invoice_total is not null
      then invoice.provider_invoice_total - calculated.calculated_total
    when invoice.manual_invoice_total is not null
      then invoice.manual_invoice_total - calculated.calculated_total
    else null
  end,
  updated_at = now()
from calculated
where invoice.id = calculated.id;

-- A provider total belongs only to the invoice whose closing date matches it.
update public.card_invoices invoice
set
  provider_invoice_total = null,
  provider_bill_status = null,
  total_source = case
    when manual_invoice_total is not null then 'manual_bank_confirmation'
    else 'calculated_transactions'
  end,
  total_amount = coalesce(manual_invoice_total, calculated_invoice_total, 0),
  invoice_total = coalesce(manual_invoice_total, calculated_invoice_total, 0),
  updated_at = now()
from public.credit_cards card
where card.id = invoice.card_id
  and invoice.provider_invoice_total is not null
  and card.provider_bill_closing_date is not null
  and invoice.closing_date <> card.provider_bill_closing_date;

-- Fire the normalizer after the repair without changing financial values.
update public.card_invoices set updated_at = now();
