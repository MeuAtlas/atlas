begin;

alter table public.financial_commitments
  add column if not exists analysis_group_id uuid
    references public.financial_analysis_groups(id) on delete set null;

create index if not exists financial_commitments_analysis_group_idx
  on public.financial_commitments(workspace_id, analysis_group_id)
  where analysis_group_id is not null;

-- Casa é um contexto financeiro do workspace, nunca uma pessoa.
update public.financial_analysis_groups
set
  group_type = 'household',
  name = 'Casa',
  is_active = true,
  archived_at = null,
  updated_at = now()
where normalized_name = 'casa';

insert into public.financial_analysis_groups (
  workspace_id,
  created_by,
  name,
  normalized_name,
  group_type,
  description,
  is_active
)
select
  workspace.id,
  workspace.owner_id,
  'Casa',
  'casa',
  'household',
  'Despesas recorrentes relacionadas à residência.',
  true
from public.workspaces workspace
where not exists (
  select 1
  from public.financial_analysis_groups analysis_group
  where analysis_group.workspace_id = workspace.id
    and analysis_group.normalized_name = 'casa'
);

create or replace function public.validate_commitment_analysis_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.analysis_group_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.financial_analysis_groups analysis_group
    where analysis_group.id = new.analysis_group_id
      and analysis_group.workspace_id = new.workspace_id
      and analysis_group.group_type = 'household'
      and analysis_group.is_active
      and analysis_group.archived_at is null
  ) then
    raise exception 'Contexto financeiro inválido para este compromisso.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_commitment_analysis_group
  on public.financial_commitments;
create trigger validate_commitment_analysis_group
before insert or update of analysis_group_id, workspace_id
on public.financial_commitments
for each row execute function public.validate_commitment_analysis_group();

commit;
