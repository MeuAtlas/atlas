import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/202608020085_card_statement_cash_reconciliation.sql",
  "utf8",
);
const idempotentAllocationMigration = readFileSync(
  "supabase/migrations/202608030095_idempotent_statement_payment_allocation.sql",
  "utf8",
);

test("migration cria pagamentos muitos-para-muitos sem reutilizar transação", () => {
  assert.match(migration, /create table if not exists public\.credit_card_statement_payments/);
  assert.match(migration, /statement_id,bank_transaction_id/);
  assert.match(migration, /allocated_amount numeric\(15,2\)/);
  assert.match(migration, /soma das alocações excede o pagamento bancário/);
});

test("migration mantém PDF opcional e não reescreve snapshots finais", () => {
  assert.match(migration, /statement_pdf_optional boolean not null default true/);
  assert.doesNotMatch(migration, /update public\.monthly_financial_reports/);
  assert.doesNotMatch(migration, /delete from public\.invoice_documents/);
});

test("migration suporta múltiplos, parciais, terceiros e RLS", () => {
  assert.match(migration, /multiple_bank_transactions/);
  assert.match(migration, /partially_paid/);
  assert.match(migration, /direct_third_party_payment/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /public\.can_edit_workspace/);
});

test("conciliação automática só usa pagamento bancário classificado", () => {
  assert.match(migration, /auto_allocate_credit_card_payment/);
  assert.match(migration, /transaction_role='invoice_payment'/);
  assert.match(migration, /candidate_count<>1/);
});

test("same statement payment allocation is idempotent and keeps the debit guard", () => {
  assert.match(idempotentAllocationMigration, /allocation\.statement_id=new\.statement_id/);
  assert.match(idempotentAllocationMigration, /allocation\.bank_transaction_id=new\.bank_transaction_id/);
  assert.match(idempotentAllocationMigration, /already_allocated\+new\.allocated_amount>transaction_amount\+0\.01/);
  assert.match(idempotentAllocationMigration, /soma das alocações excede o pagamento bancário/);
});
