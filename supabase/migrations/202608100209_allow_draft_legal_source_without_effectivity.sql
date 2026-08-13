-- Uma fonte documental DRAFT pode ser preservada antes da confirmação de vigência jurídica.
alter table public.flight_legal_instruments
  alter column effective_from drop not null;

alter table public.flight_legal_instruments
  drop constraint if exists flight_legal_instruments_effective_to_check;

alter table public.flight_legal_instruments
  add constraint flight_legal_instruments_effective_period_check check(
    (effective_from is not null and (effective_to is null or effective_to >= effective_from))
    or (status='DRAFT' and effective_from is null and effective_to is null)
  );
