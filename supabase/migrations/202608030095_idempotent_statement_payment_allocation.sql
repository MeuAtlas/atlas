-- Reconfirming the same bank transaction for the same statement is an upsert,
-- not a second allocation. BEFORE INSERT runs before ON CONFLICT, therefore
-- the validator must ignore the row that the unique conflict will replace.

create or replace function public.validate_credit_card_statement_payment_allocation()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  transaction_amount numeric(15,2);
  already_allocated numeric(15,2);
begin
  if new.bank_transaction_id is null then return new; end if;

  select abs(amount) into transaction_amount
  from public.financial_transactions
  where id=new.bank_transaction_id;

  select coalesce(sum(allocated_amount),0) into already_allocated
  from public.credit_card_statement_payments allocation
  where allocation.bank_transaction_id=new.bank_transaction_id
    and allocation.id<>new.id
    and not (
      allocation.statement_id=new.statement_id
      and allocation.bank_transaction_id=new.bank_transaction_id
    );

  if transaction_amount is null or
    already_allocated+new.allocated_amount>transaction_amount+0.01 then
    raise exception 'A soma das alocações excede o pagamento bancário.';
  end if;
  return new;
end
$$;

comment on function public.validate_credit_card_statement_payment_allocation() is
  'Valida o limite do débito sem contar duas vezes o par idempotente fatura/movimentação durante um upsert.';
