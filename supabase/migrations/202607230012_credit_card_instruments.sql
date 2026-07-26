-- Separate the credit account (limit/invoice) from the card instrument used.
alter table public.credit_cards
  add column if not exists user_archived_at timestamptz;

update public.credit_cards
set user_archived_at = coalesce(user_archived_at, updated_at)
where status = 'archived' and user_archived_at is null;

create table if not exists public.credit_card_instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  credit_card_id uuid not null references public.credit_cards(id) on delete cascade,
  external_id text not null,
  last_four_digits char(4),
  card_kind text not null default 'unknown'
    check (card_kind in ('physical','virtual','online','additional','unknown')),
  display_name text not null,
  provider_status text not null default 'active',
  user_archived_at timestamptz,
  source text not null default 'pluggy',
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, source, external_id)
);

alter table public.card_purchases
  add column if not exists instrument_id uuid
    references public.credit_card_instruments(id) on delete set null,
  add column if not exists instrument_review_status text not null default 'pending'
    check (instrument_review_status in ('pending','identified','not_provided'));

create index if not exists credit_card_instruments_card
  on public.credit_card_instruments(credit_card_id, user_archived_at);
create index if not exists card_purchases_instrument
  on public.card_purchases(instrument_id, competence_date);

alter table public.credit_card_instruments enable row level security;
create policy card_instruments_read on public.credit_card_instruments
  for select to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.credit_cards c
      where c.id = credit_card_id
        and public.can_read_finance(c.owner_id,c.workspace_id,c.visibility)
    )
  );
create policy card_instruments_write on public.credit_card_instruments
  for all to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1 from public.credit_cards c
      where c.id = credit_card_id
        and public.can_write_finance(c.owner_id,c.workspace_id,c.visibility)
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.credit_cards c
      where c.id = credit_card_id
        and public.can_write_finance(c.owner_id,c.workspace_id,c.visibility)
    )
  );

grant select,insert,update,delete on public.credit_card_instruments to authenticated;
