-- Canonical open-invoice total shared by Cards, Movements and Overview.
-- Existing aliases and confirmation snapshots remain preserved.

alter table public.card_invoices
  add column if not exists confirmed_open_total numeric(15,2),
  add column if not exists confirmed_open_total_at timestamptz,
  add column if not exists confirmed_open_total_source text;

alter table public.card_invoices
  drop constraint if exists card_invoices_confirmed_open_total_check,
  add constraint card_invoices_confirmed_open_total_check
    check(confirmed_open_total is null or confirmed_open_total >= 0),
  drop constraint if exists card_invoices_confirmed_open_source_check,
  add constraint card_invoices_confirmed_open_source_check
    check(
      confirmed_open_total_source is null or
      confirmed_open_total_source in(
        'manual_bank_confirmation',
        'manual_snapshot',
        'legacy_confirmed'
      )
    );

create index if not exists card_invoices_current_open_idx
  on public.card_invoices(owner_id,cycle_end_date desc,updated_at desc)
  where status='open';

create or replace function public.resolve_open_card_invoice_display_total()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if new.status='open' then
    new.current_display_total=coalesce(
      new.confirmed_open_total,
      new.provider_invoice_total,
      new.manual_invoice_total,
      new.calculated_invoice_total,
      new.last_reliable_invoice_total
    );
  end if;
  return new;
end
$$;

drop trigger if exists card_invoices_resolve_open_total
  on public.card_invoices;
create trigger card_invoices_resolve_open_total
before insert or update on public.card_invoices
for each row execute function public.resolve_open_card_invoice_display_total();

create or replace function public.backfill_open_card_invoice_totals(
  p_apply boolean default false
) returns jsonb
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  found_count integer:=0;
  updated_count integer:=0;
  already_canonical integer:=0;
  insufficient_count integer:=0;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  with candidates as(
    select
      invoice.id,
      coalesce(
        confirmation.official_amount,
        case
          when invoice.total_source='manual_bank_confirmation'
            or invoice.source in('manual','manual_bank_confirmation')
          then coalesce(
            invoice.confirmed_invoice_total,
            invoice.manual_invoice_total
          )
        end
      ) recovered_total
    from public.card_invoices invoice
    left join lateral(
      select confirmation.official_amount
      from public.card_invoice_confirmations confirmation
      where confirmation.owner_id=invoice.owner_id
        and confirmation.card_id=invoice.card_id
        and confirmation.reference_month=invoice.reference_month
      order by confirmation.informed_at desc
      limit 1
    ) confirmation on true
    where invoice.owner_id=auth.uid()
      and invoice.status='open'
  )
  select
    count(*) filter(
      where recovered_total is not null
    ),
    count(*) filter(
      where invoice.confirmed_open_total is not null
    ),
    count(*) filter(
      where recovered_total is null
        and invoice.confirmed_open_total is null
    )
  into found_count,already_canonical,insufficient_count
  from candidates
  join public.card_invoices invoice on invoice.id=candidates.id;

  if p_apply then
    with candidates as(
      select
        invoice.id,
        coalesce(
          confirmation.official_amount,
          case
            when invoice.total_source='manual_bank_confirmation'
              or invoice.source in('manual','manual_bank_confirmation')
            then coalesce(
              invoice.confirmed_invoice_total,
              invoice.manual_invoice_total
            )
          end
        ) recovered_total,
        coalesce(
          confirmation.informed_at,
          invoice.updated_at
        ) recovered_at,
        case
          when confirmation.official_amount is not null
            then 'manual_bank_confirmation'
          when invoice.confirmed_invoice_total is not null
            then 'legacy_confirmed'
          else 'manual_snapshot'
        end recovered_source
      from public.card_invoices invoice
      left join lateral(
        select
          confirmation.official_amount,
          confirmation.informed_at
        from public.card_invoice_confirmations confirmation
        where confirmation.owner_id=invoice.owner_id
          and confirmation.card_id=invoice.card_id
          and confirmation.reference_month=invoice.reference_month
        order by confirmation.informed_at desc
        limit 1
      ) confirmation on true
      where invoice.owner_id=auth.uid()
        and invoice.status='open'
    ), updated as(
      update public.card_invoices invoice
      set
        confirmed_open_total=candidate.recovered_total,
        confirmed_open_total_at=candidate.recovered_at,
        confirmed_open_total_source=candidate.recovered_source,
        current_display_total=candidate.recovered_total,
        reconciliation_difference=case
          when invoice.calculated_invoice_total is null then null
          else round(
            candidate.recovered_total-invoice.calculated_invoice_total,
            2
          )
        end
      from candidates candidate
      where invoice.id=candidate.id
        and candidate.recovered_total is not null
        and (
          invoice.confirmed_open_total is distinct from
            candidate.recovered_total
          or invoice.confirmed_open_total_at is null
          or invoice.confirmed_open_total_source is null
        )
      returning invoice.id
    )
    select count(*) into updated_count from updated;
  end if;

  return jsonb_build_object(
    'mode',case when p_apply then 'apply' else 'dry-run' end,
    'openInvoicesFound',found_count,
    'alreadyCanonical',already_canonical,
    'updated',updated_count,
    'insufficientInformation',insufficient_count
  );
end
$$;

revoke all on function public.backfill_open_card_invoice_totals(boolean)
  from public;
grant execute on function public.backfill_open_card_invoice_totals(boolean)
  to authenticated;

comment on column public.card_invoices.confirmed_open_total is
  'Canonical trusted total for an open invoice, independent from detail completeness.';
comment on function public.backfill_open_card_invoice_totals(boolean) is
  'Authenticated idempotent dry-run/apply backfill for canonical open-invoice totals.';
