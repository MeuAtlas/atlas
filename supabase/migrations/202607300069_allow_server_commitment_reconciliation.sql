begin;

grant execute on function public.link_financial_transaction_to_occurrence(
  uuid,
  uuid,
  uuid,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
