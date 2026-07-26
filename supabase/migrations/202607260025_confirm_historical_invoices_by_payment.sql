-- Keep confirmed invoice totals, imported lines and payments as separate facts.
-- The reconciliation routine is idempotent and only accepts one unambiguous
-- full payment for one historical invoice.

alter table public.card_invoices
  add column if not exists confirmed_invoice_total numeric(15,2),
  add column if not exists invoice_breakdown jsonb;

alter table public.card_invoices
  drop constraint if exists card_invoices_total_source_check;
alter table public.card_invoices
  add constraint card_invoices_total_source_check check (
    total_source in (
      'provider_bill',
      'manual_pdf_confirmation',
      'manual_bank_confirmation',
      'confirmed_by_full_payment',
      'calculated_transactions'
    )
  );

alter table public.card_invoices
  drop constraint if exists card_invoices_reconciliation_status_check;
alter table public.card_invoices
  add constraint card_invoices_reconciliation_status_check check (
    reconciliation_status in (
      'matched',
      'small_difference',
      'divergent',
      'provider_unavailable',
      'incomplete_transactions',
      'incomplete',
      'unavailable'
    )
  );

alter table public.card_invoice_confirmations
  add column if not exists invoice_id uuid
    references public.card_invoices(id) on delete cascade,
  add column if not exists confirmed_total numeric(15,2),
  add column if not exists confirmation_source text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists document_id text,
  add column if not exists breakdown_metadata jsonb;

alter table public.card_invoice_confirmations
  drop constraint if exists card_invoice_confirmations_source_check;
alter table public.card_invoice_confirmations
  add constraint card_invoice_confirmations_source_check check (
    source in ('manual_bank_confirmation', 'bank_pdf')
  );

update public.card_invoice_confirmations confirmation
set
  invoice_id = coalesce(confirmation.invoice_id, invoice.id),
  confirmed_total = coalesce(confirmation.confirmed_total, confirmation.official_amount),
  confirmation_source = coalesce(
    confirmation.confirmation_source,
    case when confirmation.source = 'bank_pdf'
      then 'bank_pdf'
      else 'manual_bank_confirmation'
    end
  ),
  confirmed_at = coalesce(confirmation.confirmed_at, confirmation.informed_at)
from public.card_invoices invoice
where invoice.owner_id = confirmation.owner_id
  and invoice.card_id = confirmation.card_id
  and invoice.reference_month = confirmation.reference_month;

update public.card_invoices invoice
set
  manual_invoice_total = confirmation.confirmed_total,
  confirmed_invoice_total = confirmation.confirmed_total,
  total_amount = confirmation.confirmed_total,
  invoice_total = confirmation.confirmed_total,
  total_source = case
    when confirmation.confirmation_source = 'bank_pdf'
      then 'manual_pdf_confirmation'
    else 'manual_bank_confirmation'
  end,
  invoice_breakdown = coalesce(
    confirmation.breakdown_metadata,
    invoice.invoice_breakdown
  ),
  reconciliation_difference = round(
    confirmation.confirmed_total
      - coalesce(invoice.calculated_invoice_total, 0),
    2
  ),
  reconciliation_status = case
    when abs(
      confirmation.confirmed_total
        - coalesce(invoice.calculated_invoice_total, 0)
    ) <= 0.01
      then 'matched'
    else 'incomplete'
  end,
  updated_at = now()
from public.card_invoice_confirmations confirmation
where confirmation.invoice_id = invoice.id
  and confirmation.confirmed_total is not null
  and invoice.provider_invoice_total is null;

create or replace function public.reconcile_historical_invoice_payments()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  reconciled_count integer := 0;
begin
  with candidates as (
    select
      invoice.id as invoice_id,
      invoice.card_id,
      payment.id as payment_id,
      payment.account_id,
      abs(payment.amount) as payment_amount,
      coalesce(payment.realized_at::date, payment.competence_date) as payment_date,
      count(*) over (partition by invoice.id) as invoice_match_count,
      count(*) over (partition by payment.id) as payment_match_count
    from public.card_invoices invoice
    join public.credit_cards card on card.id = invoice.card_id
    join public.financial_transactions payment
      on payment.owner_id = invoice.owner_id
      and payment.transaction_role = 'invoice_payment'
      and payment.account_id is not null
      and payment.status not in ('cancelled', 'pending', 'forecast')
      and payment.bank_direction is distinct from 'inflow'
      and coalesce(payment.realized_at::date, payment.competence_date)
        > invoice.closing_date
      and coalesce(payment.realized_at::date, payment.competence_date)
        <= invoice.due_date
      and upper(payment.description) !~ '(PARCIAL|MINIM[OA]|FINANCI|ROTATIV)'
      and (
        payment.invoice_id = invoice.id
        or payment.credit_card_id = invoice.card_id
        or (
          card.last_four_digits is not null
          and payment.description ilike '%' || card.last_four_digits || '%'
        )
        or (
          upper(coalesce(card.brand, '')) like '%MASTER%'
          and upper(payment.description) like '%MASTER%'
        )
        or (
          upper(coalesce(card.brand, '')) like '%VISA%'
          and upper(payment.description) like '%VISA%'
        )
      )
    where invoice.status in ('closed', 'paid')
      and invoice.provider_invoice_total is null
      and invoice.manual_invoice_total is null
      and coalesce(invoice.outstanding_amount, 0) <= 0.01
      and invoice.minimum_payment_amount is distinct from abs(payment.amount)
  ),
  unambiguous as (
    select *
    from candidates
    where invoice_match_count = 1
      and payment_match_count = 1
  ),
  linked as (
    update public.financial_transactions payment
    set
      invoice_id = match.invoice_id,
      credit_card_id = match.card_id,
      financial_origin = 'invoice',
      transaction_role = 'invoice_payment',
      bank_direction = 'outflow',
      updated_at = now()
    from unambiguous match
    where payment.id = match.payment_id
      and (
        payment.invoice_id is distinct from match.invoice_id
        or payment.credit_card_id is distinct from match.card_id
        or payment.financial_origin is distinct from 'invoice'
        or payment.bank_direction is distinct from 'outflow'
      )
    returning match.invoice_id
  ),
  updated as (
    update public.card_invoices invoice
    set
      confirmed_invoice_total = match.payment_amount,
      paid_amount = match.payment_amount,
      paid_at = match.payment_date::timestamptz,
      total_amount = match.payment_amount,
      invoice_total = match.payment_amount,
      outstanding_amount = 0,
      total_source = 'confirmed_by_full_payment',
      reconciliation_difference = round(
        match.payment_amount
          - coalesce(invoice.calculated_invoice_total, 0),
        2
      ),
      reconciliation_status = case
        when abs(
          match.payment_amount
            - coalesce(invoice.calculated_invoice_total, 0)
        ) <= 0.01
          then 'matched'
        else 'incomplete'
      end,
      status = 'paid',
      updated_at = now()
    from unambiguous match
    where invoice.id = match.invoice_id
      and (
        invoice.confirmed_invoice_total is distinct from match.payment_amount
        or invoice.paid_amount is distinct from match.payment_amount
        or invoice.total_source is distinct from 'confirmed_by_full_payment'
        or invoice.reconciliation_status is distinct from
          case
            when abs(
              match.payment_amount
                - coalesce(invoice.calculated_invoice_total, 0)
            ) <= 0.01
              then 'matched'
            else 'incomplete'
          end
      )
    returning invoice.id
  )
  select count(*) into reconciled_count from updated;

  return reconciled_count;
end
$$;

select public.reconcile_historical_invoice_payments();

create index if not exists financial_transactions_invoice_payment_cycle
  on public.financial_transactions(
    owner_id,
    transaction_role,
    competence_date,
    account_id
  )
  where transaction_role = 'invoice_payment';
