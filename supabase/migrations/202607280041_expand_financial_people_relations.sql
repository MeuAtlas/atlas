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
      'mother',
      'father',
      'child',
      'spouse',
      'parent',
      'dependent',
      'family',
      'other'
    )
  );

commit;
