create or replace function public.allocate_credit_card_statement_payment(
  p_statement_id uuid,
  p_transaction_id uuid,
  p_allocated_amount numeric default null
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  target public.card_invoices;
  card public.credit_cards;
  payment public.financial_transactions;
  existing_count integer;
  requested_amount numeric(15,2);
  target_expected numeric(15,2);
  tolerance numeric(15,2);
  prior_statement_ids uuid[];
  allocation_id uuid;
begin
  select * into target from public.card_invoices where id=p_statement_id;
  select * into card from public.credit_cards where id=target.card_id;
  select * into payment from public.financial_transactions where id=p_transaction_id;
  if target.id is null or card.id is null or payment.id is null then
    raise exception 'Fatura ou pagamento não encontrado.';
  end if;
  if not (card.owner_id=auth.uid() or
    (card.workspace_id is not null and public.can_edit_workspace(card.workspace_id))) then
    raise exception 'Acesso negado.' using errcode='42501';
  end if;
  if payment.owner_id<>card.owner_id or payment.bank_direction='inflow' then
    raise exception 'Movimentação incompatível com esta fatura.';
  end if;

  requested_amount := coalesce(nullif(p_allocated_amount,0),abs(payment.amount));
  target_expected := coalesce(target.expected_statement_amount,
    target.official_total_amount,target.confirmed_invoice_total,
    target.provider_invoice_total,target.manual_invoice_total,
    target.calculated_invoice_total,nullif(target.total_amount,0),0);
  tolerance := greatest(0.01,least(1.00,target_expected*0.001));
  select count(*),array_agg(statement_id) into existing_count,prior_statement_ids
    from public.credit_card_statement_payments
    where bank_transaction_id=payment.id;

  -- If the user explicitly links the complete debit to a statement whose
  -- expected value matches it, replace stale legacy associations atomically.
  -- Partial/manual split allocation remains untouched unless removed first.
  if existing_count>0 and p_allocated_amount is null
    and abs(target_expected-abs(payment.amount))<=tolerance then
    delete from public.credit_card_statement_payments
      where bank_transaction_id=payment.id;
    update public.card_invoices invoice set
      status=case when invoice.status in ('paid','partially_paid') then 'closed' else invoice.status end,
      payment_status=case when invoice.payment_status in ('paid','partially_paid') then 'unknown' else invoice.payment_status end,
      updated_at=now()
    where invoice.id=any(prior_statement_ids)
      and invoice.id<>target.id
      and not exists (
        select 1 from public.credit_card_statement_payments remaining
        where remaining.statement_id=invoice.id
      )
      and invoice.payment_confirmation_status='estimated';
  end if;

  insert into public.credit_card_statement_payments(
    owner_id,workspace_id,statement_id,bank_transaction_id,allocated_amount,
    payment_date,payment_source,is_manual,created_by
  ) values (
    card.owner_id,card.workspace_id,target.id,payment.id,requested_amount,
    coalesce(payment.user_effective_at::date,payment.effective_at::date,
      payment.bank_posted_at::date,payment.provider_posted_at::date,
      payment.realized_at::date,payment.competence_date),
    'bank_transaction',true,auth.uid()
  ) on conflict (statement_id,bank_transaction_id) where bank_transaction_id is not null
    do update set allocated_amount=excluded.allocated_amount,
      payment_date=excluded.payment_date,is_manual=true,
      created_by=auth.uid()
  returning id into allocation_id;

  update public.financial_transactions set
    invoice_id=target.id,credit_card_id=target.card_id,
    source_type='bank',financial_origin='bank_account',
    transaction_role='invoice_payment',cash_flow_kind='invoice_payment',
    financial_nature='invoice_payment',financial_role='cash_flow_only',
    bank_direction='outflow',review_status='reviewed',manually_confirmed=true,
    manual_override_at=now(),manual_override_by=auth.uid(),updated_at=now()
  where id=payment.id;
  return allocation_id;
end
$$;

grant execute on function public.allocate_credit_card_statement_payment(uuid,uuid,numeric)
to authenticated;
