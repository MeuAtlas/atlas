begin;

alter table public.financial_commitments
  add column if not exists context_type text,
  add column if not exists budget_priority text,
  add column if not exists natural_language_source text,
  add column if not exists notes text;

update public.financial_commitments
set context_type = case
  when analysis_group_id is not null then 'household'
  else 'personal'
end
where context_type is null;

update public.financial_commitments
set budget_priority = 'unknown'
where budget_priority is null;

alter table public.financial_commitments
  alter column context_type set default 'personal',
  alter column context_type set not null,
  alter column budget_priority set default 'unknown',
  alter column budget_priority set not null;

alter table public.financial_commitments
  drop constraint if exists financial_commitments_context_type_check,
  add constraint financial_commitments_context_type_check
    check (context_type in ('personal', 'household', 'work', 'travel')),
  drop constraint if exists financial_commitments_budget_priority_check,
  add constraint financial_commitments_budget_priority_check
    check (budget_priority in ('essential', 'adjustable', 'optional', 'unknown'));

create index if not exists financial_commitments_context_active_idx
  on public.financial_commitments(workspace_id, context_type, status)
  where archived_at is null;

create table if not exists public.financial_commitment_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  commitment_id uuid not null
    references public.financial_commitments(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'created',
    'updated',
    'amount_changed',
    'relation_changed',
    'payment_linked',
    'occurrence_skipped',
    'paused',
    'resumed',
    'ended'
  )),
  summary text not null,
  effective_from date,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_commitment_history_timeline_idx
  on public.financial_commitment_history(
    workspace_id,
    commitment_id,
    created_at desc
  );

alter table public.financial_commitment_history enable row level security;

drop policy if exists financial_commitment_history_read
  on public.financial_commitment_history;
create policy financial_commitment_history_read
  on public.financial_commitment_history
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.financial_commitments commitment
      where commitment.id = commitment_id
        and commitment.workspace_id = workspace_id
        and public.can_read_finance(
          commitment.created_by,
          commitment.workspace_id,
          commitment.visibility
        )
    )
  );

drop policy if exists financial_commitment_history_write
  on public.financial_commitment_history;
create policy financial_commitment_history_write
  on public.financial_commitment_history
  for all
  to authenticated
  using (
    created_by = auth.uid()
    or public.can_edit_workspace(workspace_id)
  )
  with check (
    created_by = auth.uid()
    and public.can_edit_workspace(workspace_id)
    and exists (
      select 1
      from public.financial_commitments commitment
      where commitment.id = commitment_id
        and commitment.workspace_id = workspace_id
    )
  );

grant select, insert, update, delete
  on public.financial_commitment_history
  to authenticated;

commit;
