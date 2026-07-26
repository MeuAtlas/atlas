-- Current credit-card billing cycles and provider reconciliation.
alter table public.credit_cards
  alter column closing_day drop not null,
  alter column due_day drop not null,
  add column if not exists dates_source text check (dates_source in ('pluggy','manual')),
  add column if not exists provider_invoice_total numeric(15,2);

alter table public.card_purchases
  add column if not exists competence_date date,
  add column if not exists transaction_role text not null default 'consumption'
    check (transaction_role in ('consumption','invoice_payment','refund','adjustment')),
  add column if not exists status text not null default 'realized'
    check (status in ('pending','realized','cancelled')),
  add column if not exists review_status text not null default 'reviewed'
    check (review_status in ('pending','reviewed','ignored')),
  add column if not exists original_amount numeric(15,2);

update public.card_purchases
set competence_date = coalesce(competence_date, bill_forecast_date, purchase_date)
where competence_date is null;

alter table public.card_invoices
  add column if not exists cycle_start_date date,
  add column if not exists cycle_end_date date,
  add column if not exists purchases_total numeric(15,2) not null default 0,
  add column if not exists credits_total numeric(15,2) not null default 0,
  add column if not exists adjustments_total numeric(15,2) not null default 0,
  add column if not exists invoice_total numeric(15,2) not null default 0,
  add column if not exists outstanding_amount numeric(15,2) not null default 0,
  add column if not exists purchase_count integer not null default 0,
  add column if not exists source text not null default 'atlas',
  add column if not exists provider_updated_at timestamptz,
  add column if not exists provider_invoice_total numeric(15,2),
  add column if not exists calculated_invoice_total numeric(15,2),
  add column if not exists reconciliation_difference numeric(15,2),
  add column if not exists reconciliation_status text not null default 'provider_unavailable'
    check (reconciliation_status in ('matched','small_difference','divergent','provider_unavailable','incomplete_transactions'));

alter table public.card_invoices drop constraint if exists card_invoices_status_check;
alter table public.card_invoices add constraint card_invoices_status_check
  check (status in ('open','closed','due','partially_paid','paid','overdue','cancelled','partial'));

create index if not exists card_purchases_card_competence
  on public.card_purchases(card_id, competence_date)
  where status <> 'cancelled';
create index if not exists card_purchases_pending_review
  on public.card_purchases(owner_id, review_status)
  where review_status = 'pending';
