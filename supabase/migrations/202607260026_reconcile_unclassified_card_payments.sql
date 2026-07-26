-- The first reconciliation routine only considered transactions that were
-- already classified as invoice_payment. Santander describes this debit as
-- "PAGAMENTO CARTAO CREDITO ... CARTAO MASTER", so older imports can still be
-- ordinary bank cash flow. Discover that conservative shape, then classify,
-- link and reconcile it atomically.

create or replace function public.reconcile_historical_invoice_payments()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  match record;
  reconciled_count integer := 0;
  changed_count integer := 0;
begin
  for match in
    with candidates as (
      select
        invoice.id as invoice_id,
        invoice.card_id,
        payment.id as payment_id,
        payment.account_id,
        abs(payment.amount) as payment_amount,
        coalesce(
          payment.realized_at::date,
          payment.bank_posted_at::date,
          payment.competence_date
        ) as payment_date,
        count(*) over (partition by invoice.id) as invoice_match_count,
        count(*) over (partition by payment.id) as payment_match_count
      from public.card_invoices invoice
      join public.credit_cards card on card.id = invoice.card_id
      join public.financial_transactions payment
        on payment.owner_id = invoice.owner_id
        and payment.account_id is not null
        and payment.source_type = 'bank'
        and payment.status not in ('cancelled', 'pending', 'forecast')
        and (
          payment.bank_direction = 'outflow'
          or payment.transaction_type = 'expense'
          or payment.original_amount < 0
        )
        and coalesce(
          payment.realized_at::date,
          payment.bank_posted_at::date,
          payment.competence_date
        ) > invoice.closing_date
        and coalesce(
          payment.realized_at::date,
          payment.bank_posted_at::date,
          payment.competence_date
        ) <= invoice.due_date
        and upper(payment.description)
          ~ '(PAGAMENTO|PGTO).*(CARTAO|CARTÃO).*(CREDITO|CRÉDITO|MASTER|VISA)'
        and upper(payment.description)
          !~ '(PARCIAL|MINIM[OA]|MÍNIM[OA]|FINANCI|ROTATIV)'
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
    )
    select *
    from candidates
    where invoice_match_count = 1
      and payment_match_count = 1
  loop
    update public.financial_transactions payment
    set
      invoice_id = match.invoice_id,
      credit_card_id = match.card_id,
      transaction_type = 'transfer',
      transaction_role = 'invoice_payment',
      financial_origin = 'invoice',
      cash_flow_kind = 'invoice_payment',
      bank_direction = 'outflow',
      financial_nature = 'invoice_payment',
      financial_role = 'cash_flow_only',
      classification_source = 'description_assisted',
      classification_confidence = 'high',
      classification_rule = 'bank.invoice_payment.card_description',
      classification_version = 'bank_classifier_v2',
      suspected_transfer = false,
      review_status = 'reviewed',
      updated_at = now()
    where payment.id = match.payment_id;

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
    where invoice.id = match.invoice_id
      and (
        invoice.confirmed_invoice_total is distinct from match.payment_amount
        or invoice.paid_amount is distinct from match.payment_amount
        or invoice.total_source is distinct from 'confirmed_by_full_payment'
        or invoice.reconciliation_difference is distinct from round(
          match.payment_amount
            - coalesce(invoice.calculated_invoice_total, 0),
          2
        )
        or invoice.reconciliation_status is distinct from
          case
            when abs(
              match.payment_amount
                - coalesce(invoice.calculated_invoice_total, 0)
            ) <= 0.01
              then 'matched'
            else 'incomplete'
          end
      );

    get diagnostics changed_count = row_count;
    reconciled_count := reconciled_count + changed_count;
  end loop;

  return reconciled_count;
end
$$;

select public.reconcile_historical_invoice_payments();
