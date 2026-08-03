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
  existing_allocation public.credit_card_statement_payments;
  existing_count integer;
  requested_amount numeric(15,2);
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
  select count(*) into existing_count
    from public.credit_card_statement_payments
    where bank_transaction_id=payment.id;
  select * into existing_allocation
    from public.credit_card_statement_payments
    where bank_transaction_id=payment.id
    order by created_at
    limit 1;

  -- An explicit user choice may correct one automatic legacy association.
  -- Manual or split allocations remain protected from implicit replacement.
  if existing_count=1
    and existing_allocation.statement_id<>target.id
    and p_allocated_amount is null
    and not existing_allocation.is_manual then
    update public.credit_card_statement_payments set
      statement_id=target.id,
      owner_id=card.owner_id,
      workspace_id=card.workspace_id,
      allocated_amount=requested_amount,
      payment_date=coalesce(payment.user_effective_at::date,payment.effective_at::date,
        payment.bank_posted_at::date,payment.provider_posted_at::date,
        payment.realized_at::date,payment.competence_date),
      payment_source='bank_transaction',
      is_manual=true,
      created_by=auth.uid()
    where id=existing_allocation.id
    returning id into allocation_id;
  else
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
  end if;

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
