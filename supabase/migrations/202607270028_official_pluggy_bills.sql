-- Official Pluggy Bills remain in card_invoices, the existing Atlas invoice
-- entity. Payments and finance charges are separate, idempotent facts.

alter table public.card_invoices
  add column if not exists provider text not null default 'atlas',
  add column if not exists provider_bill_id text,
  add column if not exists provider_account_id text,
  add column if not exists currency_code char(3) not null default 'BRL',
  add column if not exists allows_installments boolean,
  add column if not exists payment_status text not null default 'unknown',
  add column if not exists last_provider_error text,
  add column if not exists raw_breakdown_metadata jsonb;

alter table public.card_invoices
  drop constraint if exists card_invoices_payment_status_check;
alter table public.card_invoices
  add constraint card_invoices_payment_status_check check (
    payment_status in (
      'open','partially_paid','paid','installment_payment','overdue','unknown'
    )
  );

alter table public.card_invoices
  drop constraint if exists card_invoices_provider_status_check;
alter table public.card_invoices
  add constraint card_invoices_provider_status_check check (
    provider_status in (
      'available','degraded','unavailable','temporarily_unavailable','waiting'
    )
  );

alter table public.card_invoices
  drop constraint if exists card_invoices_reconciliation_status_check;
alter table public.card_invoices
  add constraint card_invoices_reconciliation_status_check check (
    reconciliation_status in (
      'matched','small_difference','divergent','incomplete_assignment',
      'provider_unavailable','incomplete_transactions','incomplete',
      'unavailable','reconciled','over_identified'
    )
  );

create unique index if not exists card_invoices_provider_identity
  on public.card_invoices(owner_id, workspace_id, provider, provider_bill_id)
  nulls not distinct
  where provider_bill_id is not null;

create table if not exists public.credit_card_bill_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  visibility text not null default 'private'
    check (visibility in ('private','workspace')),
  bill_id uuid not null references public.card_invoices(id) on delete cascade,
  provider_payment_id text not null,
  value_type text not null check (
    value_type in ('FULL_PAYMENT','INSTALLMENT_PAYMENT','OTHER_PAYMENT')
  ),
  payment_date date,
  payment_mode text check (
    payment_mode is null or payment_mode in (
      'DEBIT_ACCOUNT','BANK_SLIP','PAYROLL_DEDUCTION','PIX'
    )
  ),
  amount numeric(15,2) not null check (amount >= 0),
  currency_code char(3) not null default 'BRL',
  linked_bank_transaction_id uuid
    references public.financial_transactions(id) on delete set null,
  provider text not null default 'pluggy',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, provider_payment_id),
  check (
    (visibility='private' and workspace_id is null)
    or (visibility='workspace' and workspace_id is not null)
  )
);

create table if not exists public.credit_card_bill_finance_charges (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  visibility text not null default 'private'
    check (visibility in ('private','workspace')),
  bill_id uuid not null references public.card_invoices(id) on delete cascade,
  provider_charge_id text not null,
  charge_type text not null check (
    charge_type in (
      'LATE_PAYMENT_REMUNERATIVE_INTEREST','LATE_PAYMENT_FEE',
      'LATE_PAYMENT_INTEREST','IOF','OTHER'
    )
  ),
  amount numeric(15,2) not null check (amount >= 0),
  currency_code char(3) not null default 'BRL',
  additional_info text,
  provider text not null default 'pluggy',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, provider_charge_id)
);

create table if not exists public.pluggy_item_identities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bank_connection_id uuid not null
    references public.bank_connections(id) on delete cascade,
  provider_identity_id text not null,
  provider_item_id text not null,
  normalized_name text,
  document_hash text,
  document_mask text,
  document_type text,
  ownership_validated boolean not null default false,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider_identity_id),
  unique(bank_connection_id)
);

create table if not exists public.pluggy_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  item_hash text,
  owner_id uuid references auth.users(id) on delete set null,
  bank_connection_id uuid
    references public.bank_connections(id) on delete set null,
  status text not null check (
    status in ('queued','processing','completed','ignored','failed')
  ),
  error_code text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.bank_connections
  add column if not exists provider_sync_state text not null default 'idle',
  add column if not exists action_required text,
  add column if not exists user_message text,
  add column if not exists is_complete boolean,
  add column if not exists pages_received integer,
  add column if not exists total_pages integer,
  add column if not exists records_received integer;

alter table public.bank_connections
  drop constraint if exists bank_connections_provider_sync_state_check;
alter table public.bank_connections
  add constraint bank_connections_provider_sync_state_check check (
    provider_sync_state in (
      'idle','queued','updating','waiting_mfa','waiting_credentials',
      'partial','success','error','connector_offline','rate_limited'
    )
  );

create or replace function public.enforce_official_bill_child_scope()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare parent record;
begin
  select owner_id,workspace_id,visibility
  into parent
  from public.card_invoices
  where id=new.bill_id;

  if not found then
    raise foreign_key_violation using message='Official bill does not exist.';
  end if;

  new.owner_id:=parent.owner_id;
  new.workspace_id:=parent.workspace_id;
  new.visibility:=parent.visibility;
  return new;
end
$$;

drop trigger if exists enforce_bill_payment_scope
  on public.credit_card_bill_payments;
create trigger enforce_bill_payment_scope
before insert or update of bill_id,owner_id,workspace_id,visibility
on public.credit_card_bill_payments
for each row execute function public.enforce_official_bill_child_scope();

drop trigger if exists enforce_bill_charge_scope
  on public.credit_card_bill_finance_charges;
create trigger enforce_bill_charge_scope
before insert or update of bill_id,owner_id,workspace_id,visibility
on public.credit_card_bill_finance_charges
for each row execute function public.enforce_official_bill_child_scope();

alter table public.credit_card_bill_payments enable row level security;
alter table public.credit_card_bill_finance_charges enable row level security;
alter table public.pluggy_item_identities enable row level security;
alter table public.pluggy_webhook_events enable row level security;

drop policy if exists bill_payments_read on public.credit_card_bill_payments;
drop policy if exists bill_payments_write on public.credit_card_bill_payments;
create policy bill_payments_read on public.credit_card_bill_payments
  for select to authenticated
  using (public.can_read_finance(owner_id,workspace_id,visibility));
create policy bill_payments_write on public.credit_card_bill_payments
  for all to authenticated
  using (public.can_write_finance(owner_id,workspace_id,visibility))
  with check (public.can_write_finance(owner_id,workspace_id,visibility));

drop policy if exists bill_charges_read on public.credit_card_bill_finance_charges;
drop policy if exists bill_charges_write on public.credit_card_bill_finance_charges;
create policy bill_charges_read on public.credit_card_bill_finance_charges
  for select to authenticated
  using (public.can_read_finance(owner_id,workspace_id,visibility));
create policy bill_charges_write on public.credit_card_bill_finance_charges
  for all to authenticated
  using (public.can_write_finance(owner_id,workspace_id,visibility))
  with check (public.can_write_finance(owner_id,workspace_id,visibility));

drop policy if exists item_identities_read on public.pluggy_item_identities;
drop policy if exists item_identities_write on public.pluggy_item_identities;
create policy item_identities_read on public.pluggy_item_identities
  for select to authenticated using (owner_id=auth.uid());
create policy item_identities_write on public.pluggy_item_identities
  for all to authenticated using (owner_id=auth.uid())
  with check (owner_id=auth.uid());

grant select,insert,update,delete on
  public.credit_card_bill_payments,
  public.credit_card_bill_finance_charges,
  public.pluggy_item_identities
to authenticated;

create or replace function public.recalculate_official_card_bill(target_bill uuid)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare
  total numeric(15,2);
  calculated numeric(15,2);
  paid numeric(15,2);
  installment boolean;
  full_compatible boolean;
  target_due date;
begin
  select
    coalesce(provider_invoice_total,manual_invoice_total,
      confirmed_invoice_total,calculated_invoice_total,
      last_reliable_invoice_total),
    calculated_invoice_total,
    due_date
  into total,calculated,target_due
  from public.card_invoices where id=target_bill for update;

  select
    coalesce(sum(amount),0),
    coalesce(bool_or(value_type='INSTALLMENT_PAYMENT'),false),
    coalesce(bool_or(
      value_type='FULL_PAYMENT'
      and total is not null and abs(amount-total)<=0.01
    ),false)
  into paid,installment,full_compatible
  from public.credit_card_bill_payments where bill_id=target_bill;

  update public.card_invoices set
    paid_amount=paid,
    outstanding_amount=case when total is null then 0
      else greatest(0,total-paid) end,
    payment_status=case
      when installment then 'installment_payment'
      when full_compatible or (total is not null and paid>=total-0.01)
        then 'paid'
      when paid>0 then 'partially_paid'
      when target_due<current_date then 'overdue'
      when total is null then 'unknown'
      else 'open'
    end,
    reconciliation_difference=case
      when total is null or calculated is null then null
      else round(total-calculated,2) end,
    reconciliation_status=case
      when total is null or calculated is null then 'unavailable'
      when abs(total-calculated)<=0.01 then 'reconciled'
      when total>calculated then 'incomplete'
      else 'over_identified'
    end,
    updated_at=now()
  where id=target_bill;
end
$$;

create or replace function public.link_official_bill_payments()
returns integer
language plpgsql
security invoker
set search_path=''
as $$
declare linked_count integer;
begin
  with candidates as (
    select
      payment.id payment_id,
      payment.bill_id,
      transaction.id transaction_id,
      count(*) over(partition by payment.id) payment_matches,
      count(*) over(partition by transaction.id) transaction_matches
    from public.credit_card_bill_payments payment
    join public.card_invoices bill on bill.id=payment.bill_id
    join public.financial_transactions transaction
      on transaction.owner_id=payment.owner_id
     and transaction.account_id is not null
     and transaction.status not in ('cancelled','pending','forecast')
     and transaction.manually_confirmed=false
     and transaction.bank_direction is distinct from 'inflow'
     and abs(abs(transaction.amount)-payment.amount)<=0.01
     and abs(coalesce(transaction.realized_at::date,transaction.competence_date)
       - payment.payment_date)<=3
     and upper(transaction.description) ~
       '(PAGAMENTO.*CART|CART.*CREDIT|FATURA|MASTERCARD|VISA)'
    where payment.linked_bank_transaction_id is null
  ), unambiguous as (
    select * from candidates
    where payment_matches=1 and transaction_matches=1
  ), linked as (
    update public.credit_card_bill_payments payment set
      linked_bank_transaction_id=match.transaction_id,
      updated_at=now()
    from unambiguous match where payment.id=match.payment_id
    returning payment.id
  ), classified as (
    update public.financial_transactions transaction set
      invoice_id=match.bill_id,
      transaction_type='transfer',
      transaction_role='invoice_payment',
      financial_origin='invoice',
      cash_flow_kind='invoice_payment',
      bank_direction='outflow',
      financial_nature='invoice_payment',
      financial_role='cash_flow_only',
      review_status='reviewed',
      updated_at=now()
    from unambiguous match where transaction.id=match.transaction_id
    returning transaction.id
  )
  select count(*) into linked_count from linked;
  return linked_count;
end
$$;

create or replace function public.official_bill_backfill_dry_run()
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select jsonb_build_object(
    'invoices_analyzed',count(*),
    'provider_bills',count(*) filter(where provider_bill_id is not null),
    'payments_linked',(
      select count(*) from public.credit_card_bill_payments
      where linked_bank_transaction_id is not null
    ),
    'divergences',count(*) filter(
      where reconciliation_status in ('incomplete','over_identified','divergent')
    ),
    'records_preserved',count(*) filter(
      where last_reliable_invoice_total is not null
    ),
    'ambiguities',(
      select count(*) from public.credit_card_bill_payments
      where linked_bank_transaction_id is null
    )
  ) from public.card_invoices
$$;
