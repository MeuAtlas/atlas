-- Qualify the invoice identity used by the PDF confirmation RPC. In PL/pgSQL,
-- the previous ON CONFLICT (card_id, reference_month) target was ambiguous
-- because reference_month is also a local variable in the function.
do $migration$
declare
  previous_definition text;
  fixed_definition text;
begin
  select pg_get_functiondef(
    'public.confirm_invoice_pdf_import(uuid,jsonb)'::regprocedure
  ) into previous_definition;

  fixed_definition := regexp_replace(
    previous_definition,
    'on\s+conflict\s*\(\s*card_id\s*,\s*reference_month\s*\)',
    'ON CONFLICT ON CONSTRAINT card_invoices_card_id_reference_month_key',
    'i'
  );

  if fixed_definition = previous_definition then
    raise exception 'confirm_invoice_pdf_import_conflict_target_not_found';
  end if;

  execute fixed_definition;
end
$migration$;
