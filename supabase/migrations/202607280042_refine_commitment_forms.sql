begin;

alter table public.financial_people
  drop constraint if exists financial_people_relation_type_check;

alter table public.financial_people
  add constraint financial_people_relation_type_check
  check (
    relation_type in (
      'self',
      'daughter',
      'son',
      'wife',
      'husband',
      'ex_spouse',
      'mother',
      'father',
      'other_dependent',
      'child',
      'spouse',
      'parent',
      'dependent',
      'family',
      'other'
    )
  );

alter table public.financial_commitments
  add column if not exists cash_flow_direction text not null default 'expense',
  add column if not exists include_in_monthly_budget boolean not null default true,
  add column if not exists same_invoice boolean not null default false,
  add column if not exists tags text[] not null default '{}';

alter table public.financial_commitments
  drop constraint if exists financial_commitments_cash_flow_direction_check;

alter table public.financial_commitments
  add constraint financial_commitments_cash_flow_direction_check
  check (cash_flow_direction in ('expense', 'income'));

alter table public.financial_commitments
  drop constraint if exists financial_commitments_same_invoice_card_check;

alter table public.financial_commitments
  add constraint financial_commitments_same_invoice_card_check
  check (not same_invoice or card_id is not null);

create index if not exists financial_commitments_tags_idx
  on public.financial_commitments using gin(tags);

commit;
