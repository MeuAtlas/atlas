begin;

-- Service-side reconciliation and scheduled sync run with the service role.
-- New tables do not automatically inherit table privileges from older grants.
grant select, insert, update, delete
  on public.financial_commitments,
     public.financial_commitment_occurrences,
     public.financial_occurrence_transactions,
     public.commitment_payment_sources
  to service_role;

grant select
  on public.financial_transactions
  to service_role;

notify pgrst, 'reload schema';

commit;
