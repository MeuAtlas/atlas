-- A fatura pertence ao mes em que fecha; o vencimento pode cair no mes seguinte.
-- Datas confirmadas pelo PDF nao podem ser deslocadas por uma projecao posterior.

create or replace function public.align_pdf_statement_reference_month()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if new.source='pdf' or new.total_source='manual_pdf_confirmation' then
    new.reference_month := date_trunc(
      'month',coalesce(new.closing_date,new.cycle_end_date,new.due_date)
    )::date;
  end if;
  return new;
end;
$$;

drop trigger if exists card_invoices_align_pdf_reference_month
  on public.card_invoices;
create trigger card_invoices_align_pdf_reference_month
before insert or update on public.card_invoices
for each row execute function public.align_pdf_statement_reference_month();

create or replace function public.preserve_confirmed_pdf_statement_axes()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if old.document_id is not null
     and (old.source='pdf' or old.details_status='confirmed')
     and new.source is distinct from 'pdf' then
    new.reference_month := old.reference_month;
    new.cycle_start_date := old.cycle_start_date;
    new.cycle_end_date := old.cycle_end_date;
    new.closing_date := old.closing_date;
    new.due_date := old.due_date;
    new.source := old.source;
    new.document_id := old.document_id;
    new.manual_invoice_total := old.manual_invoice_total;
    new.official_total := old.official_total;
    new.pdf_total_amount := old.pdf_total_amount;
    new.details_status := old.details_status;
    new.confirmed_by_user := old.confirmed_by_user;
    if old.status in ('closed','paid','overdue','partially_paid')
       and new.status in ('open','estimated') then
      new.status := old.status;
    end if;
    new.preservation_reason := 'pdf_statement_axes_preserved';
  end if;
  return new;
end;
$$;

drop trigger if exists card_invoices_preserve_confirmed_pdf_axes
  on public.card_invoices;
create trigger card_invoices_preserve_confirmed_pdf_axes
before update on public.card_invoices
for each row execute function public.preserve_confirmed_pdf_statement_axes();

create or replace function public.preserve_pdf_confirmed_card_schedule()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if old.dates_source='pdf_confirmed'
     and new.dates_source is distinct from 'pdf_confirmed' then
    new.closing_day := old.closing_day;
    new.due_day := old.due_day;
    new.dates_source := old.dates_source;
  end if;
  return new;
end;
$$;

drop trigger if exists credit_cards_preserve_pdf_confirmed_schedule
  on public.credit_cards;
create trigger credit_cards_preserve_pdf_confirmed_schedule
before update on public.credit_cards
for each row execute function public.preserve_pdf_confirmed_card_schedule();

-- Registros antigos sao normalizados em leitura a partir do parsed_payload do
-- proprio documento confirmado. A migracao nao altera historico financeiro.
