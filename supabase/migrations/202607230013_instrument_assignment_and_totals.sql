alter table public.card_purchases
  add column if not exists instrument_last_four char(4),
  add column if not exists assignment_status text not null default 'unassigned'
    check (assignment_status in ('assigned','inferred','unassigned','conflicting','pending_review')),
  add column if not exists assignment_source text,
  add column if not exists assignment_confirmed_by_user boolean not null default false,
  add column if not exists assigned_at timestamptz;

alter table public.card_invoices
  add column if not exists instruments_total numeric(15,2) not null default 0,
  add column if not exists unassigned_total numeric(15,2) not null default 0,
  add column if not exists general_adjustments_total numeric(15,2) not null default 0;

alter table public.card_invoices drop constraint if exists card_invoices_reconciliation_status_check;
alter table public.card_invoices add constraint card_invoices_reconciliation_status_check
  check (reconciliation_status in ('matched','small_difference','divergent','incomplete_assignment','provider_unavailable','incomplete_transactions'));

with candidates as (
  select p.id purchase_id,min(i.id::text)::uuid instrument_id
  from public.card_purchases p
  join public.credit_card_instruments i
    on i.credit_card_id=p.card_id
   and i.last_four_digits=p.instrument_last_four
  where p.instrument_id is null
    and p.instrument_last_four is not null
    and not p.assignment_confirmed_by_user
  group by p.id
  having count(*)=1
)
update public.card_purchases p
set instrument_id = candidate.id,
    assignment_status = 'inferred',
    assignment_source = 'instrument_last_four',
    assigned_at = coalesce(p.assigned_at,now()),
    instrument_review_status = 'identified'
from (select purchase_id,instrument_id id from candidates) candidate
where p.id=candidate.purchase_id;

update public.card_purchases
set assignment_status='unassigned',
    assignment_source=coalesce(assignment_source,'provider_not_provided')
where instrument_id is null
  and not assignment_confirmed_by_user;

create index if not exists card_purchases_assignment_review
  on public.card_purchases(owner_id,assignment_status)
  where assignment_status in ('unassigned','conflicting','pending_review');
