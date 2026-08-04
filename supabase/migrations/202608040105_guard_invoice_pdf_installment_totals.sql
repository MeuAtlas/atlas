-- Installment descriptors are normalized by the application before the RPC.
-- Keep this version reserved so environments that already discovered the
-- invalid descriptor do not receive a second, dynamic function rewrite.
select 1;
