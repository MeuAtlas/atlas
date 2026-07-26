create table if not exists public.card_invoice_confirmations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  reference_month date not null,
  official_amount numeric(15,2) not null check (official_amount >= 0),
  source text not null default 'manual_bank_confirmation'
    check (source = 'manual_bank_confirmation'),
  informed_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,card_id,reference_month)
);

create table if not exists public.credit_card_sync_diagnostics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  sync_run_id uuid references public.financial_sync_runs(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete cascade,
  received_from_pluggy integer not null default 0,
  mapped integer not null default 0,
  persisted integer not null default 0,
  included_in_invoice integer not null default 0,
  excluded_from_invoice integer not null default 0,
  pages integer not null default 0,
  page_sizes jsonb not null default '[]'::jsonb,
  status_counts jsonb not null default '{}'::jsonb,
  classification_counts jsonb not null default '{}'::jsonb,
  reference_counts jsonb not null default '{}'::jsonb,
  instrument_counts jsonb not null default '{}'::jsonb,
  exclusion_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(sync_run_id,card_id)
);

alter table public.card_invoice_confirmations enable row level security;
alter table public.credit_card_sync_diagnostics enable row level security;

create policy card_invoice_confirmations_owner
  on public.card_invoice_confirmations for all to authenticated
  using(owner_id=auth.uid()) with check(owner_id=auth.uid());
create policy credit_card_sync_diagnostics_read
  on public.credit_card_sync_diagnostics for select to authenticated
  using(owner_id=auth.uid());
create policy credit_card_sync_diagnostics_insert
  on public.credit_card_sync_diagnostics for insert to authenticated
  with check(owner_id=auth.uid());

grant select,insert,update on public.card_invoice_confirmations to authenticated;
grant select,insert on public.credit_card_sync_diagnostics to authenticated;

create trigger card_invoice_confirmations_set_updated_at
before update on public.card_invoice_confirmations
for each row execute function public.set_updated_at();

create or replace function public.validate_owned_credit_card_reference()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if new.owner_id<>auth.uid() or not exists (
    select 1 from public.credit_cards
    where id=new.card_id and owner_id=new.owner_id
  ) then
    raise exception 'credit card access denied';
  end if;
  return new;
end
$$;

create trigger card_invoice_confirmations_validate_owner
before insert or update on public.card_invoice_confirmations
for each row execute function public.validate_owned_credit_card_reference();
create trigger credit_card_sync_diagnostics_validate_owner
before insert or update on public.credit_card_sync_diagnostics
for each row execute function public.validate_owned_credit_card_reference();

alter table public.card_invoices drop constraint if exists card_invoices_total_source_check;
alter table public.card_invoices add constraint card_invoices_total_source_check
  check (total_source in ('provider_bill','manual_bank_confirmation','calculated_transactions'));
