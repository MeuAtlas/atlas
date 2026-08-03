alter table public.financial_months
  drop constraint if exists financial_months_status_check;
alter table public.financial_months
  add constraint financial_months_status_check check (status in (
    'planned','open','awaiting_consolidation','review','needs_attention',
    'closing','closed','reopened'
  ));

create or replace function public.validate_financial_month_transition()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.status=old.status then return new; end if;
  if not (
    (old.status='planned' and new.status='open') or
    (old.status='open' and new.status in ('awaiting_consolidation','review','needs_attention')) or
    (old.status='awaiting_consolidation' and new.status in ('review','needs_attention')) or
    (old.status='needs_attention' and new.status='review') or
    (old.status='review' and new.status='closing') or
    (old.status='closing' and new.status='closed') or
    (old.status='closed' and new.status='reopened') or
    (old.status='reopened' and new.status in ('review','needs_attention'))
  ) then
    raise exception 'Transição inválida para o mês financeiro: % -> %',old.status,new.status
      using errcode='23514';
  end if;
  return new;
end $$;

comment on column public.financial_months.status is
  'planned antes do início; open no mês vigente; review/needs_attention ao terminar; closed preserva o snapshot.';
