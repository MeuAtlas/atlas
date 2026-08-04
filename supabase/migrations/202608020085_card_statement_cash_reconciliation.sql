-- Credit-card statements follow cash basis in monthly reports. The statement
-- payment is confirmed by one or more real bank debits; statement PDFs remain
-- optional evidence. Final monthly snapshots are intentionally not rewritten.

alter table public.card_invoices
  add column if not exists expected_statement_amount numeric(15,2),
  add column if not exists current_open_amount numeric(15,2),
  add column if not exists personal_share_amount numeric(15,2),
  add column if not exists third_party_share_amount numeric(15,2),
  add column if not exists detected_payment_amount numeric(15,2) not null default 0,
  add column if not exists confirmed_payment_amount numeric(15,2) not null default 0,
  add column if not exists payment_difference numeric(15,2),
  add column if not exists payment_confirmation_status text not null default 'estimated',
  add column if not exists payment_confirmation_source text,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists statement_status text not null default 'estimated',
  add column if not exists statement_pdf_optional boolean not null default true,
  add column if not exists legacy_confirmation_source text,
  add column if not exists legacy_statement_month_logic boolean not null default false;

alter table public.card_invoices
  drop constraint if exists card_invoices_payment_confirmation_status_check;
alter table public.card_invoices
  add constraint card_invoices_payment_confirmation_status_check check (
    payment_confirmation_status in (
      'open','estimated','payment_detected','partially_paid','paid','overpaid',
      'payment_mismatch','manually_confirmed','cancelled'
    )
  );

alter table public.card_invoices
  drop constraint if exists card_invoices_payment_confirmation_source_check;
alter table public.card_invoices
  add constraint card_invoices_payment_confirmation_source_check check (
    payment_confirmation_source is null or payment_confirmation_source in (
      'bank_transaction','multiple_bank_transactions',
      'direct_third_party_payment','manual_confirmation',
      'legacy_pdf_confirmation','integration_bill'
    )
  );

create table if not exists public.credit_card_statement_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  financial_profile_id uuid,
  statement_id uuid not null references public.card_invoices(id) on delete cascade,
  bank_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  allocated_amount numeric(15,2) not null check (allocated_amount > 0),
  payment_date date not null,
  payment_source text not null check (payment_source in (
    'bank_transaction','multiple_bank_transactions',
    'direct_third_party_payment','manual_confirmation',
    'legacy_pdf_confirmation','integration_bill'
  )),
  is_manual boolean not null default false,
  is_third_party boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists credit_card_statement_payment_transaction_unique
  on public.credit_card_statement_payments(statement_id,bank_transaction_id)
  where bank_transaction_id is not null;
create index if not exists credit_card_statement_payments_statement_date
  on public.credit_card_statement_payments(statement_id,payment_date);
create index if not exists credit_card_statement_payments_workspace_date
  on public.credit_card_statement_payments(workspace_id,payment_date);

alter table public.credit_card_statement_payments enable row level security;
drop policy if exists statement_payments_read on public.credit_card_statement_payments;
drop policy if exists statement_payments_write on public.credit_card_statement_payments;
create policy statement_payments_read on public.credit_card_statement_payments
  for select to authenticated using (
    owner_id=auth.uid() or
    (workspace_id is not null and public.is_workspace_member(workspace_id))
  );
create policy statement_payments_write on public.credit_card_statement_payments
  for all to authenticated using (
    owner_id=auth.uid() or
    (workspace_id is not null and public.can_edit_workspace(workspace_id))
  ) with check (
    owner_id=auth.uid() or
    (workspace_id is not null and public.can_edit_workspace(workspace_id))
  );

create or replace function public.validate_credit_card_statement_payment_allocation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare transaction_amount numeric(15,2); already_allocated numeric(15,2);
begin
  if new.bank_transaction_id is null then return new; end if;
  select abs(amount) into transaction_amount from public.financial_transactions
    where id=new.bank_transaction_id;
  select coalesce(sum(allocated_amount),0) into already_allocated
    from public.credit_card_statement_payments
    where bank_transaction_id=new.bank_transaction_id and id<>new.id;
  if transaction_amount is null or already_allocated+new.allocated_amount>transaction_amount+0.01 then
    raise exception 'A soma das alocações excede o pagamento bancário.';
  end if;
  return new;
end
$$;

drop trigger if exists credit_card_statement_payment_validate on public.credit_card_statement_payments;
create trigger credit_card_statement_payment_validate
before insert or update on public.credit_card_statement_payments
for each row execute function public.validate_credit_card_statement_payment_allocation();

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
    statement_status=case when target.status='cancelled' then 'cancelled' when next_status in ('paid','overpaid','manually_confirmed') then 'paid' when next_status='partially_paid' then 'partially_paid' when target.status='open' then 'open' else 'estimated' end,
    updated_at=now()
  where id=target.id;
end
$$;

create or replace function public.refresh_credit_card_statement_after_payment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform public.refresh_credit_card_statement_payment_state(
    case when tg_op='DELETE' then old.statement_id else new.statement_id end
  );
  if tg_op='UPDATE' and old.statement_id is distinct from new.statement_id then
    perform public.refresh_credit_card_statement_payment_state(old.statement_id);
  end if;
  return coalesce(new,old);
end
$$;

drop trigger if exists credit_card_statement_payment_refresh on public.credit_card_statement_payments;
create trigger credit_card_statement_payment_refresh
after insert or update or delete on public.credit_card_statement_payments
for each row execute function public.refresh_credit_card_statement_after_payment();

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
  allocation_id uuid;
begin
  select * into target from public.card_invoices where id=p_statement_id;
  select * into card from public.credit_cards where id=target.card_id;
  select * into payment from public.financial_transactions where id=p_transaction_id;
  if target.id is null or card.id is null or payment.id is null then raise exception 'Fatura ou pagamento não encontrado.'; end if;
  if not (card.owner_id=auth.uid() or (card.workspace_id is not null and public.can_edit_workspace(card.workspace_id))) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if payment.owner_id<>card.owner_id or payment.bank_direction='inflow' then raise exception 'Movimentação incompatível com esta fatura.'; end if;

  insert into public.credit_card_statement_payments(
    owner_id,workspace_id,statement_id,bank_transaction_id,allocated_amount,
    payment_date,payment_source,is_manual,created_by
  ) values (
    card.owner_id,card.workspace_id,target.id,payment.id,
    coalesce(nullif(p_allocated_amount,0),abs(payment.amount)),
    coalesce(payment.user_effective_at::date,payment.effective_at::date,
      payment.bank_posted_at::date,payment.provider_posted_at::date,
      payment.realized_at::date,payment.competence_date),
    'bank_transaction',true,auth.uid()
  ) on conflict (statement_id,bank_transaction_id) where bank_transaction_id is not null
    do update set statement_id=excluded.statement_id,
      allocated_amount=excluded.allocated_amount,payment_date=excluded.payment_date,
      is_manual=true,created_by=auth.uid()
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

create or replace function public.remove_credit_card_statement_payment(
  p_payment_id uuid
) returns void
language plpgsql security definer set search_path=''
as $$
declare target public.credit_card_statement_payments;
begin
  select * into target from public.credit_card_statement_payments where id=p_payment_id;
  if target.id is null then return; end if;
  if not (target.owner_id=auth.uid() or (target.workspace_id is not null and public.can_edit_workspace(target.workspace_id))) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  delete from public.credit_card_statement_payments where id=target.id;
end
$$;

create or replace function public.confirm_credit_card_statement_payment(
  p_statement_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_direct_third_party boolean default false
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare target public.card_invoices; card public.credit_cards; allocation_id uuid;
begin
  select * into target from public.card_invoices where id=p_statement_id;
  select * into card from public.credit_cards where id=target.card_id;
  if target.id is null or card.id is null or p_amount<=0 then raise exception 'Confirmação inválida.'; end if;
  if not (card.owner_id=auth.uid() or (card.workspace_id is not null and public.can_edit_workspace(card.workspace_id))) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  insert into public.credit_card_statement_payments(
    owner_id,workspace_id,statement_id,allocated_amount,payment_date,
    payment_source,is_manual,is_third_party,created_by
  ) values (
    card.owner_id,card.workspace_id,target.id,p_amount,p_payment_date,
    case when p_direct_third_party then 'direct_third_party_payment' else 'manual_confirmation' end,
    true,p_direct_third_party,auth.uid()
  ) returning id into allocation_id;
  update public.card_invoices set payment_confirmed_by=auth.uid() where id=target.id;
  return allocation_id;
end
$$;

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

create or replace function public.auto_allocate_credit_card_payment_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$ begin perform public.auto_allocate_credit_card_payment(new.id); return new; end $$;

drop trigger if exists financial_transactions_card_statement_payment on public.financial_transactions;
create trigger financial_transactions_card_statement_payment
after insert or update of invoice_id,credit_card_id,transaction_role,cash_flow_kind,
  financial_nature,bank_direction,status,amount,competence_date,realized_at
on public.financial_transactions for each row
execute function public.auto_allocate_credit_card_payment_trigger();

update public.card_invoices set
  expected_statement_amount=coalesce(expected_statement_amount,official_total_amount,
    confirmed_invoice_total,provider_invoice_total,manual_invoice_total,
    calculated_invoice_total,nullif(total_amount,0)),
  current_open_amount=case when status='open' then coalesce(current_open_amount,
    confirmed_open_total,current_display_total,provider_invoice_total,
    calculated_invoice_total,total_amount) else current_open_amount end,
  statement_pdf_optional=true,
  legacy_confirmation_source=coalesce(legacy_confirmation_source,total_source,
    official_amount_source),
  legacy_statement_month_logic=true,
  statement_status=case when status='cancelled' then 'cancelled' when status='open' then 'open' when status in ('paid') then 'paid' when status in ('partial','partially_paid') then 'partially_paid' else 'estimated' end;

insert into public.credit_card_statement_payments(
  owner_id,workspace_id,statement_id,bank_transaction_id,allocated_amount,
  payment_date,payment_source,is_manual,created_by
)
select invoice.owner_id,card.workspace_id,invoice.id,payment.id,abs(payment.amount),
  coalesce(payment.user_effective_at::date,payment.effective_at::date,
    payment.bank_posted_at::date,payment.provider_posted_at::date,
    payment.realized_at::date,payment.competence_date),
  'bank_transaction',false,null
from public.financial_transactions payment
join public.card_invoices invoice on invoice.id=payment.invoice_id
join public.credit_cards card on card.id=invoice.card_id
where payment.account_id is not null
  and payment.status not in ('cancelled','pending','forecast','failed')
  and payment.bank_direction is distinct from 'inflow'
  and (payment.transaction_role='invoice_payment' or
    payment.cash_flow_kind='invoice_payment' or
    payment.financial_nature='invoice_payment')
on conflict (statement_id,bank_transaction_id) where bank_transaction_id is not null do nothing;

do $$ declare statement_id uuid; begin
  for statement_id in select id from public.card_invoices loop
    perform public.refresh_credit_card_statement_payment_state(statement_id);
  end loop;
end $$;

grant select,insert,update,delete on public.credit_card_statement_payments to authenticated;
grant execute on function public.allocate_credit_card_statement_payment(uuid,uuid,numeric),
  public.remove_credit_card_statement_payment(uuid),
  public.confirm_credit_card_statement_payment(uuid,numeric,date,boolean)
to authenticated;

comment on table public.credit_card_statement_payments is
  'Pagamentos reais ou confirmados alocados a faturas. O caixa usa somente débitos bancários do usuário.';
comment on column public.card_invoices.statement_pdf_optional is
  'O PDF é anexo opcional de detalhamento e nunca a condição de confirmação do pagamento.';
