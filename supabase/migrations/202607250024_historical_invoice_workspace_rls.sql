-- Historical invoices follow the same privacy scope as their credit card.
alter table public.card_invoices
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null,
  add column if not exists visibility text not null default 'private'
    check (visibility in ('private', 'workspace'));

update public.card_invoices invoice
set
  workspace_id = card.workspace_id,
  visibility = card.visibility
from public.credit_cards card
where card.id = invoice.card_id
  and (
    invoice.workspace_id is distinct from card.workspace_id
    or invoice.visibility is distinct from card.visibility
  );

alter table public.card_invoices
  drop constraint if exists card_invoices_workspace_visibility_check;
alter table public.card_invoices
  add constraint card_invoices_workspace_visibility_check
  check (
    (visibility = 'private' and workspace_id is null)
    or (visibility = 'workspace' and workspace_id is not null)
  );

drop policy if exists invoices_read on public.card_invoices;
drop policy if exists invoices_write on public.card_invoices;
create policy invoices_read on public.card_invoices
  for select to authenticated
  using (public.can_read_finance(owner_id, workspace_id, visibility));
create policy invoices_write on public.card_invoices
  for all to authenticated
  using (public.can_write_finance(owner_id, workspace_id, visibility))
  with check (public.can_write_finance(owner_id, workspace_id, visibility));

create index if not exists card_invoices_history_scope
  on public.card_invoices(owner_id, workspace_id, due_date desc, id desc)
  where status in ('closed', 'due', 'partially_paid', 'paid', 'overdue', 'cancelled');

create or replace function public.sync_card_invoice_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  card_owner uuid;
  card_workspace uuid;
  card_visibility text;
begin
  select owner_id, workspace_id, visibility
  into card_owner, card_workspace, card_visibility
  from public.credit_cards
  where id = new.card_id;

  if card_owner is null then
    raise exception 'credit card not found';
  end if;
  new.owner_id := card_owner;
  new.workspace_id := card_workspace;
  new.visibility := card_visibility;
  return new;
end
$$;

drop trigger if exists card_invoices_sync_scope on public.card_invoices;
create trigger card_invoices_sync_scope
before insert or update of card_id on public.card_invoices
for each row execute function public.sync_card_invoice_scope();

create or replace function public.propagate_card_invoice_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.card_invoices
  set
    owner_id = new.owner_id,
    workspace_id = new.workspace_id,
    visibility = new.visibility
  where card_id = new.id;
  return new;
end
$$;

drop trigger if exists credit_cards_propagate_invoice_scope on public.credit_cards;
create trigger credit_cards_propagate_invoice_scope
after update of owner_id, workspace_id, visibility on public.credit_cards
for each row
when (
  old.owner_id is distinct from new.owner_id
  or old.workspace_id is distinct from new.workspace_id
  or old.visibility is distinct from new.visibility
)
execute function public.propagate_card_invoice_scope();
