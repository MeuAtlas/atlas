begin;

-- The reconciliation function locks the selected transaction with FOR UPDATE
-- before linking it, so the server role also needs UPDATE privilege.
grant update
  on public.financial_transactions
  to service_role;

commit;
