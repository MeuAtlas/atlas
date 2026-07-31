-- Separates the bank invoice total from the amount the card owner expects to pay.
alter table public.credit_card_instruments
  add column if not exists payment_responsible_person_id uuid
    references public.financial_people(id) on delete set null,
  add column if not exists responsibility_updated_at timestamptz;

create index if not exists credit_card_instruments_payment_responsible_idx
  on public.credit_card_instruments(payment_responsible_person_id)
  where payment_responsible_person_id is not null;

create or replace function public.validate_card_instrument_payment_responsibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  card_workspace uuid;
  person_workspace uuid;
  person_creator uuid;
  person_active boolean;
begin
  if new.payment_responsible_person_id is null then
    return new;
  end if;

  select workspace_id
    into card_workspace
    from public.credit_cards
   where id = new.credit_card_id
     and owner_id = new.owner_id;

  select workspace_id, created_by, is_active and archived_at is null
    into person_workspace, person_creator, person_active
    from public.financial_people
   where id = new.payment_responsible_person_id;

  if person_creator is null or person_creator <> new.owner_id or not person_active then
    raise exception 'invalid card payment responsible person';
  end if;

  if card_workspace is not null and card_workspace <> person_workspace then
    raise exception 'card and payment responsible person workspace mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists credit_card_instruments_validate_payment_responsibility
  on public.credit_card_instruments;
create trigger credit_card_instruments_validate_payment_responsibility
before insert or update of payment_responsible_person_id, credit_card_id, owner_id
on public.credit_card_instruments
for each row execute function public.validate_card_instrument_payment_responsibility();

comment on column public.credit_card_instruments.payment_responsible_person_id is
  'Person expected to reimburse or pay the purchases made with this instrument. Does not alter the bank invoice total.';
comment on column public.credit_card_instruments.responsibility_updated_at is
  'Last time the user changed the payment responsibility for this instrument.';
