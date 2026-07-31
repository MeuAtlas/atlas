import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/202607300066_settle_card_commitments_by_invoice.sql",
), "utf8");

test("fatura paga quita compromissos pelo cartão e pela competência", () => {
  assert.match(migration, /commitment\.card_id = target_invoice\.card_id/);
  assert.match(
    migration,
    /occurrence\.competence_month = target_invoice\.reference_month/,
  );
  assert.match(migration, /commitment\.payment_method = 'credit_card'/);
  assert.match(migration, /status = 'paid'/);
  assert.match(migration, /match_source = 'card_invoice'/);
});

test("vínculo explícito da compra prevalece na virada do ciclo", () => {
  assert.match(migration, /purchase\.invoice_id = target_invoice\.id/);
  assert.match(migration, /purchase\.invoice_id = invoice\.id/);
  assert.match(migration, /order by \(purchase\.invoice_id = invoice\.id\) desc/);
});

test("valor da fatura não é rateado nem duplica o valor analítico", () => {
  assert.match(
    migration,
    /paid_amount = coalesce\(occurrence\.expected_amount, occurrence\.actual_amount, 0\)/,
  );
  assert.doesNotMatch(
    migration,
    /occurrence\.(actual_amount|paid_amount)\s*=\s*target_invoice\.total_amount/,
  );
  assert.doesNotMatch(
    migration,
    /occurrence\.(actual_amount|paid_amount)\s*=\s*target_invoice\.paid_amount/,
  );
});

test("pagamento parcial não quita todas as despesas", () => {
  assert.match(
    migration,
    /target_invoice\.status = 'paid'[\s\S]*target_invoice\.payment_status = 'paid'/,
  );
  assert.doesNotMatch(
    migration,
    /target_invoice\.status\s+in\s+\([^)]*partially_paid/,
  );
});

test("migração é idempotente, reprocessa e não apaga histórico", () => {
  assert.match(
    migration,
    /create or replace function public\.reconcile_card_commitment_invoice/,
  );
  assert.match(migration, /card_invoice_settle_commitments/);
  assert.match(migration, /commitment_occurrence_settle_paid_invoice/);
  assert.doesNotMatch(
    migration,
    /delete from public\.(financial_commitment_occurrences|card_invoices|card_purchases)/i,
  );
});
