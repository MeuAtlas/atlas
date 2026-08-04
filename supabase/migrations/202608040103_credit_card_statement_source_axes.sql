-- Explicit statement source, detail and payment axes. This migration is
-- additive so older Pluggy/PDF/report readers remain compatible.

alter table public.card_invoices
  add column if not exists details_status text not null default 'unavailable',
  add column if not exists pluggy_bill_total_amount numeric(15,2),
  add column if not exists pdf_total_amount numeric(15,2),
  add column if not exists manual_total_amount numeric(15,2),
  add column if not exists confirmed_total_amount numeric(15,2),
  add column if not exists confirmed_total_source text,
  add column if not exists confirmed_total_source_locked boolean not null default false,
  add column if not exists total_difference numeric(15,2),
  add column if not exists closed_at timestamptz;

alter table public.card_invoices
  drop constraint if exists card_invoices_details_status_check,
  drop constraint if exists card_invoices_confirmed_total_source_check;
alter table public.card_invoices
  add constraint card_invoices_details_status_check check (
    details_status in ('estimated','awaiting_pdf','confirmed','unavailable')
  ),
  add constraint card_invoices_confirmed_total_source_check check (
    confirmed_total_source is null or confirmed_total_source in (
      'pluggy_open_estimate','pluggy_bill','statement_pdf','bank_payment','manual'
    )
  );

create or replace function public.sync_credit_card_statement_axes()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  new.pluggy_bill_total_amount := coalesce(
    new.pluggy_bill_total_amount,
    new.provider_invoice_total
  );

  if new.document_id is not null
     and (new.source='pdf' or new.total_source='manual_pdf_confirmation') then
    new.pdf_total_amount := coalesce(
      new.pdf_total_amount,
      new.official_total,
      new.manual_invoice_total,
      new.total_amount
    );
  end if;

  if new.total_source='manual_bank_confirmation' then
    new.manual_total_amount := coalesce(
      new.manual_total_amount,
      new.manual_invoice_total
    );
  end if;

  if new.confirmed_total_source_locked and new.confirmed_total_source='pluggy_bill'
     and new.pluggy_bill_total_amount is not null then
    new.confirmed_total_amount := new.pluggy_bill_total_amount;
  elsif new.confirmed_total_source_locked and new.confirmed_total_source='statement_pdf'
     and new.pdf_total_amount is not null then
    new.confirmed_total_amount := new.pdf_total_amount;
  else
    new.confirmed_total_amount := coalesce(
      new.pdf_total_amount,new.pluggy_bill_total_amount,new.manual_total_amount,
      new.confirmed_invoice_total,new.calculated_invoice_total
    );
    new.confirmed_total_source := case
      when new.pdf_total_amount is not null then 'statement_pdf'
      when new.pluggy_bill_total_amount is not null then 'pluggy_bill'
      when new.manual_total_amount is not null then 'manual'
      when new.confirmed_invoice_total is not null then 'bank_payment'
      when new.calculated_invoice_total is not null then 'pluggy_open_estimate'
      else null
    end;
  end if;
  new.total_difference := case
    when new.pdf_total_amount is not null and new.pluggy_bill_total_amount is not null
      then round(new.pdf_total_amount-new.pluggy_bill_total_amount,2)
    else null
  end;
  new.details_status := case
    when new.document_id is not null and new.pdf_total_amount is not null then 'confirmed'
    when new.status in ('open','estimated') and new.calculated_invoice_total is not null then 'estimated'
    when new.status in ('open','estimated') then 'unavailable'
    when new.status='cancelled' then 'unavailable'
    else 'awaiting_pdf'
  end;
  if new.status not in ('open','estimated') then
    new.closed_at := coalesce(new.closed_at,new.provider_updated_at,new.updated_at,now());
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_sync_statement_axes on public.card_invoices;
create trigger card_invoices_sync_statement_axes
before insert or update on public.card_invoices
for each row execute function public.sync_credit_card_statement_axes();

update public.card_invoices set
  pluggy_bill_total_amount=provider_invoice_total,
  pdf_total_amount=case
    when document_id is not null and (source='pdf' or total_source='manual_pdf_confirmation')
      then coalesce(official_total,manual_invoice_total,total_amount)
    else pdf_total_amount
  end,
  manual_total_amount=case
    when total_source='manual_bank_confirmation' then manual_invoice_total
    else manual_total_amount
  end;

alter table public.invoice_documents
  add column if not exists target_statement_id uuid references public.card_invoices(id) on delete set null,
  add column if not exists supersedes_document_id uuid references public.invoice_documents(id) on delete set null;

alter table public.invoice_processing_versions
  add column if not exists statement_id uuid references public.card_invoices(id) on delete set null,
  add column if not exists supersedes_version_id uuid references public.invoice_processing_versions(id) on delete set null,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

create table if not exists public.statement_transaction_source_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  statement_id uuid not null references public.card_invoices(id) on delete cascade,
  invoice_entry_id uuid references public.invoice_entries(id) on delete cascade,
  source_type text not null check (source_type in (
    'pluggy_open_estimate','pluggy_bill','statement_pdf','bank_payment','manual'
  )),
  source_entity_id text,
  confidence numeric(5,4) not null default 1 check (confidence between 0 and 1),
  confirmed_by_user boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create unique index if not exists statement_transaction_source_links_unique
  on public.statement_transaction_source_links(
    statement_id,source_type,coalesce(invoice_entry_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_entity_id,'')
  );
create index if not exists statement_transaction_source_links_statement
  on public.statement_transaction_source_links(statement_id,source_type);

alter table public.statement_transaction_source_links enable row level security;
drop policy if exists statement_transaction_source_links_read on public.statement_transaction_source_links;
drop policy if exists statement_transaction_source_links_write on public.statement_transaction_source_links;
create policy statement_transaction_source_links_read
  on public.statement_transaction_source_links for select to authenticated
  using (owner_id=auth.uid() or public.is_workspace_member(workspace_id));
create policy statement_transaction_source_links_write
  on public.statement_transaction_source_links for all to authenticated
  using (owner_id=auth.uid() or public.can_edit_workspace(workspace_id))
  with check (owner_id=auth.uid() or public.can_edit_workspace(workspace_id));
grant select,insert,update,delete on public.statement_transaction_source_links to authenticated;

insert into public.statement_transaction_source_links(
  workspace_id,owner_id,statement_id,invoice_entry_id,source_type,
  source_entity_id,confidence,confirmed_by_user,created_by
)
select entry.workspace_id,entry.owner_id,entry.bill_id,entry.id,'statement_pdf',
  entry.id::text,entry.confidence,true,entry.owner_id
from public.invoice_entries entry
on conflict do nothing;

insert into public.statement_transaction_source_links(
  workspace_id,owner_id,statement_id,invoice_entry_id,source_type,
  source_entity_id,confidence,confirmed_by_user,created_by
)
select entry.workspace_id,entry.owner_id,entry.bill_id,entry.id,'pluggy_bill',
  entry.provider_transaction_id,entry.confidence,true,entry.owner_id
from public.invoice_entries entry
where entry.provider_transaction_id is not null
on conflict do nothing;

create or replace function public.link_invoice_entry_statement_sources()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  insert into public.statement_transaction_source_links(
    workspace_id,owner_id,statement_id,invoice_entry_id,source_type,
    source_entity_id,confidence,confirmed_by_user,created_by
  ) values (
    new.workspace_id,new.owner_id,new.bill_id,new.id,'statement_pdf',
    new.id::text,new.confidence,true,new.owner_id
  ) on conflict do nothing;
  if new.provider_transaction_id is not null then
    insert into public.statement_transaction_source_links(
      workspace_id,owner_id,statement_id,invoice_entry_id,source_type,
      source_entity_id,confidence,confirmed_by_user,created_by
    ) values (
      new.workspace_id,new.owner_id,new.bill_id,new.id,'pluggy_bill',
      new.provider_transaction_id,new.confidence,true,new.owner_id
    ) on conflict do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists invoice_entries_link_statement_sources on public.invoice_entries;
create trigger invoice_entries_link_statement_sources
after insert or update of provider_transaction_id,bill_id on public.invoice_entries
for each row execute function public.link_invoice_entry_statement_sources();

create index if not exists invoice_documents_target_statement
  on public.invoice_documents(target_statement_id,created_at desc)
  where deleted_at is null;
