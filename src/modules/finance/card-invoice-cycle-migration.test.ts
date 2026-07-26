import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202607250023_repair_current_credit_card_cycles.sql",
  ),
  "utf8",
);

test("migration separa início do ciclo no dia posterior ao fechamento", () => {
  assert.match(migration, /cycle_start_date[\s\S]*\+ 1 as cycle_start_date/);
  assert.match(migration, /cycle_end_date = normalized\.closing_date/);
  assert.match(migration, /closing_date = normalized\.closing_date/);
});

test("migration reatribui pagamento somente após o fechamento e até o vencimento", () => {
  assert.match(migration, /purchase\.transaction_role = 'invoice_payment'/);
  assert.match(migration, /> invoice\.cycle_end_date/);
  assert.match(migration, /<= invoice\.due_date/);
  assert.match(migration, /purchase\.transaction_role <> 'invoice_payment'/);
});

test("migration preserva ids, é idempotente e mantém histórico", () => {
  assert.match(migration, /on conflict \(card_id, reference_month\) do nothing/);
  assert.doesNotMatch(migration, /delete from public\.card_invoices/);
  assert.doesNotMatch(migration, /delete from public\.card_purchases/);
  assert.match(migration, /create or replace function public\.normalize_card_invoice_status/);
});

test("migration mantém totais oficial, manual e calculado separados", () => {
  assert.match(migration, /provider_invoice_total/);
  assert.match(migration, /manual_invoice_total/);
  assert.match(migration, /calculated_invoice_total/);
  assert.match(migration, /reconciliation_difference/);
  assert.match(migration, /total_source/);
});
