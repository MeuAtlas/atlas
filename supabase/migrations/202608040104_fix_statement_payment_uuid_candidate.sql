-- PostgreSQL has no min(uuid). The candidate is only used when count(*)=1,
-- so the first UUID in the aggregate is deterministic enough for this guard.
create or replace function public.auto_allocate_credit_card_payment(
  p_transaction_id uuid
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare payment public.financial_transactions; target_id uuid; candidate_count integer; allocation_id uuid;
begin
  select * into payment from public.financial_transactions where id=p_transaction_id;
  if payment.id is null or payment.account_id is null or
    payment.status in ('cancelled','pending','forecast','failed') or
    payment.bank_direction='inflow' or not (
      payment.transaction_role='invoice_payment' or
      payment.cash_flow_kind='invoice_payment' or
      payment.financial_nature='invoice_payment'
    ) then return null; end if;

  target_id := payment.invoice_id;
  if target_id is null and payment.credit_card_id is not null then
    select count(*),(array_agg(invoice.id))[1] into candidate_count,target_id
    from public.card_invoices invoice
    where invoice.owner_id=payment.owner_id
      and invoice.card_id=payment.credit_card_id
      and invoice.status<>'cancelled'
      and invoice.due_date between
        coalesce(payment.realized_at::date,payment.competence_date)-interval '35 days'
        and coalesce(payment.realized_at::date,payment.competence_date)+interval '35 days';
    if candidate_count<>1 then target_id:=null; end if;
  end if;
  if target_id is null then return null; end if;

  insert into public.credit_card_statement_payments(
    owner_id,workspace_id,statement_id,bank_transaction_id,allocated_amount,
    payment_date,payment_source,is_manual,created_by
  ) select card.owner_id,card.workspace_id,invoice.id,payment.id,abs(payment.amount),
      coalesce(payment.user_effective_at::date,payment.effective_at::date,
        payment.bank_posted_at::date,payment.provider_posted_at::date,
        payment.realized_at::date,payment.competence_date),
      'bank_transaction',false,null
    from public.card_invoices invoice join public.credit_cards card on card.id=invoice.card_id
    where invoice.id=target_id and invoice.owner_id=payment.owner_id
  on conflict (statement_id,bank_transaction_id) where bank_transaction_id is not null do nothing
  returning id into allocation_id;
  return allocation_id;
end
$$;
