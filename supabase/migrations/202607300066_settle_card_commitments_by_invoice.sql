-- A credit-card purchase is an analytical expense. The bank transaction that
-- pays the invoice is only a cash event and must never be distributed by value
-- among purchases. A fully paid invoice settles the commitments of its card
-- and cycle while each commitment keeps its own amount.

create or replace function public.reconcile_card_commitment_invoice(
  p_invoice_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_invoice record;
  affected integer := 0;
  exact_affected integer := 0;
begin
  select
    invoice.id,
    invoice.card_id,
    invoice.reference_month,
    invoice.due_date,
    invoice.paid_at,
    invoice.status,
    invoice.payment_status
  into target_invoice
  from public.card_invoices invoice
  where invoice.id = p_invoice_id;

  if not found
    or not (
      target_invoice.status = 'paid'
      or target_invoice.payment_status = 'paid'
    )
  then
    return 0;
  end if;

  update public.financial_commitment_occurrences occurrence
  set
    status = 'paid',
    actual_amount = coalesce(occurrence.actual_amount, occurrence.expected_amount, 0),
    paid_amount = coalesce(occurrence.expected_amount, occurrence.actual_amount, 0),
    payment_date = coalesce(
      target_invoice.paid_at::date,
      target_invoice.due_date
    ),
    linked_invoice_id = target_invoice.id,
    match_source = 'card_invoice',
    match_confidence = 1,
    realized_at = coalesce(
      occurrence.realized_at,
      target_invoice.paid_at,
      target_invoice.due_date::timestamptz
    ),
    updated_at = now()
  from public.financial_commitments commitment
  where commitment.id = occurrence.commitment_id
    and commitment.card_id = target_invoice.card_id
    and commitment.payment_method = 'credit_card'
    and occurrence.competence_month = target_invoice.reference_month
    and occurrence.status not in ('cancelled', 'skipped', 'disputed')
    and (
      occurrence.linked_invoice_id is null
      or occurrence.linked_invoice_id = target_invoice.id
    );

  get diagnostics affected = row_count;

  -- An explicitly linked card purchase is authoritative even when its purchase
  -- date and the provider's reference month differ around the closing date.
  update public.financial_commitment_occurrences occurrence
  set
    status = 'paid',
    actual_amount = coalesce(occurrence.actual_amount, occurrence.expected_amount, 0),
    paid_amount = coalesce(occurrence.actual_amount, occurrence.expected_amount, 0),
    payment_date = coalesce(
      target_invoice.paid_at::date,
      target_invoice.due_date
    ),
    linked_invoice_id = target_invoice.id,
    match_source = 'card_invoice',
    match_confidence = 1,
    realized_at = coalesce(
      occurrence.realized_at,
      target_invoice.paid_at,
      target_invoice.due_date::timestamptz
    ),
    updated_at = now()
  from public.financial_commitments commitment,
       public.card_purchases purchase
  where commitment.id = occurrence.commitment_id
    and purchase.id = occurrence.linked_card_movement_id
    and purchase.invoice_id = target_invoice.id
    and commitment.payment_method = 'credit_card'
    and occurrence.status not in ('cancelled', 'skipped', 'disputed');

  get diagnostics exact_affected = row_count;
  affected := affected + exact_affected;
  return affected;
end;
$$;

create or replace function public.reconcile_card_commitment_invoices(
  p_workspace_id uuid,
  p_commitment_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice record;
  affected integer := 0;
begin
  if auth.role() <> 'service_role'
    and not public.can_edit_workspace(p_workspace_id)
  then
    raise exception 'workspace_access_denied' using errcode = '42501';
  end if;

  for invoice in
    select distinct card_invoice.id
    from public.card_invoices card_invoice
    join public.financial_commitments commitment
      on commitment.card_id = card_invoice.card_id
     and commitment.workspace_id = p_workspace_id
     and commitment.payment_method = 'credit_card'
    where (p_commitment_id is null or commitment.id = p_commitment_id)
      and (
        card_invoice.status = 'paid'
        or card_invoice.payment_status = 'paid'
      )
  loop
    affected := affected
      + public.reconcile_card_commitment_invoice(invoice.id);
  end loop;

  return affected;
end;
$$;

revoke all on function public.reconcile_card_commitment_invoice(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_card_commitment_invoices(uuid, uuid)
  to authenticated, service_role;

create or replace function public.reconcile_card_commitments_after_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'paid' or new.payment_status = 'paid' then
    perform public.reconcile_card_commitment_invoice(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists card_invoice_settle_commitments
  on public.card_invoices;
create trigger card_invoice_settle_commitments
after insert or update of
  status,
  payment_status,
  paid_amount,
  paid_at,
  reference_month,
  card_id
on public.card_invoices
for each row execute function
  public.reconcile_card_commitments_after_invoice();

create or replace function public.settle_new_card_commitment_occurrence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid_invoice record;
begin
  select
    invoice.id,
    invoice.due_date,
    invoice.paid_at,
    purchase.id as purchase_id
  into paid_invoice
  from public.financial_commitments commitment
  join public.card_invoices invoice
    on invoice.card_id = commitment.card_id
  left join public.card_purchases purchase
    on purchase.id = new.linked_card_movement_id
  where commitment.id = new.commitment_id
    and commitment.payment_method = 'credit_card'
    and (
      purchase.invoice_id = invoice.id
      or (
        purchase.id is null
        and invoice.reference_month = new.competence_month
      )
    )
    and (invoice.status = 'paid' or invoice.payment_status = 'paid')
  order by (purchase.invoice_id = invoice.id) desc
  limit 1;

  if found and new.status not in ('cancelled', 'skipped', 'disputed') then
    new.status := 'paid';
    new.actual_amount := coalesce(new.actual_amount, new.expected_amount, 0);
    new.paid_amount := case
      when paid_invoice.purchase_id is not null
        then coalesce(new.actual_amount, new.expected_amount, 0)
      else coalesce(new.expected_amount, new.actual_amount, 0)
    end;
    new.payment_date := coalesce(paid_invoice.paid_at::date, paid_invoice.due_date);
    new.linked_invoice_id := paid_invoice.id;
    new.match_source := 'card_invoice';
    new.match_confidence := 1;
    new.realized_at := coalesce(
      new.realized_at,
      paid_invoice.paid_at,
      paid_invoice.due_date::timestamptz
    );
  end if;
  return new;
end;
$$;

drop trigger if exists commitment_occurrence_settle_paid_invoice
  on public.financial_commitment_occurrences;
create trigger commitment_occurrence_settle_paid_invoice
before insert or update of
  commitment_id,
  competence_month,
  expected_amount,
  linked_card_movement_id,
  status
on public.financial_commitment_occurrences
for each row execute function
  public.settle_new_card_commitment_occurrence();

do $$
declare
  invoice record;
begin
  for invoice in
    select id
    from public.card_invoices
    where status = 'paid' or payment_status = 'paid'
  loop
    perform public.reconcile_card_commitment_invoice(invoice.id);
  end loop;
end;
$$;
