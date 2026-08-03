create or replace function public.refresh_credit_card_statement_payment_state(
  p_statement_id uuid
) returns void
language plpgsql security definer set search_path=''
as $$
declare
  target public.card_invoices;
  expected numeric(15,2);
  bank_total numeric(15,2);
  settled_total numeric(15,2);
  payment_count integer;
  third_party_count integer;
  manual_count integer;
  latest_payment date;
  tolerance numeric(15,2);
  next_status text;
  next_source text;
begin
  select * into target from public.card_invoices where id=p_statement_id for update;
  if target.id is null then return; end if;

  expected := coalesce(
    target.expected_statement_amount,
    target.official_total_amount,
    target.confirmed_invoice_total,
    target.provider_invoice_total,
    target.manual_invoice_total,
    target.calculated_invoice_total,
    nullif(target.total_amount,0),
    0
  );
  select
    coalesce(sum(allocated_amount) filter (where bank_transaction_id is not null and not is_third_party),0),
    coalesce(sum(allocated_amount),0), count(*),
    count(*) filter (where is_third_party or payment_source='direct_third_party_payment'),
    count(*) filter (where is_manual), max(payment_date)
  into bank_total,settled_total,payment_count,third_party_count,manual_count,latest_payment
  from public.credit_card_statement_payments where statement_id=target.id;

  tolerance := greatest(0.01,least(1.00,expected*0.001));
  next_status := case
    when target.status='cancelled' then 'cancelled'
    when payment_count=0 and target.status='open' then 'open'
    when payment_count=0 then 'estimated'
    when manual_count>0 and abs(settled_total-expected)<=tolerance then 'manually_confirmed'
    when expected<=0 then 'payment_detected'
    when abs(settled_total-expected)<=tolerance then 'paid'
    when settled_total>expected+tolerance then 'overpaid'
    when settled_total<expected-tolerance then 'partially_paid'
    else 'payment_mismatch'
  end;
  next_source := case
    when payment_count=0 then null
    when manual_count>0 then 'manual_confirmation'
    when third_party_count=payment_count then 'direct_third_party_payment'
    when payment_count>1 then 'multiple_bank_transactions'
    else 'bank_transaction'
  end;

  update public.card_invoices set
    expected_statement_amount=expected,
    detected_payment_amount=bank_total,
    confirmed_payment_amount=settled_total,
    payment_difference=round(settled_total-expected,2),
    payment_confirmation_status=next_status,
    payment_confirmation_source=next_source,
    payment_confirmed_at=case when next_status in ('paid','overpaid','manually_confirmed') then latest_payment::timestamptz else null end,
    paid_amount=bank_total,
    paid_at=case when bank_total>0 then latest_payment::timestamptz else paid_at end,
    outstanding_amount=greatest(0,expected-settled_total),
    status=case
      when target.status='cancelled' then 'cancelled'
      when next_status in ('paid','overpaid','manually_confirmed') then 'paid'
      when next_status='partially_paid' then 'partially_paid'
      else target.status
    end,
    payment_status=case
      when target.status='cancelled' then target.payment_status
      when next_status in ('paid','overpaid','manually_confirmed') then 'paid'
      when next_status='partially_paid' then 'partially_paid'
      when target.status='open' then 'open'
      else 'unknown'
    end,
    statement_status=case when target.status='cancelled' then 'cancelled' when next_status in ('paid','overpaid','manually_confirmed') then 'paid' when next_status='partially_paid' then 'partially_paid' when target.status='open' then 'open' else 'estimated' end,
    updated_at=now()
  where id=target.id;
end
$$;

-- Existing rows with an explicit card association predate the trigger from 085.
-- Re-run the same conservative allocator once, then refresh every statement.
do $$
declare transaction_id uuid;
begin
  for transaction_id in
    select id from public.financial_transactions
    where account_id is not null
      and status not in ('cancelled','pending','forecast','failed')
      and bank_direction is distinct from 'inflow'
      and (transaction_role='invoice_payment' or
        cash_flow_kind='invoice_payment' or
        financial_nature='invoice_payment')
  loop
    perform public.auto_allocate_credit_card_payment(transaction_id);
  end loop;
end
$$;

do $$
declare statement_id uuid;
begin
  for statement_id in select id from public.card_invoices loop
    perform public.refresh_credit_card_statement_payment_state(statement_id);
  end loop;
end
$$;
