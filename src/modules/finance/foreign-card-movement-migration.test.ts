import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/202607280036_foreign_card_movements.sql",
  "utf8",
);

test("migration separa valor BRL, moeda original e dados da conversão", () => {
  for (const field of [
    "amount_brl",
    "provider_signed_amount",
    "original_amount",
    "original_currency_code",
    "exchange_rate",
    "foreign_iof_amount",
    "conversion_source",
    "converted_at",
    "posting_date",
  ]) assert.match(sql, new RegExp(field));
});

test("migration enriquece PDF e possui backfill autenticado com dry-run", () => {
  assert.match(sql, /enrich_invoice_foreign_values/);
  assert.match(sql, /backfill_foreign_card_movements/);
  assert.match(sql, /p_apply boolean default false/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /internationalFound/);
  assert.match(sql, /insufficientInformation/);
  assert.match(sql, /iofsLinked/);
});

test("backfill e índices são idempotentes", () => {
  assert.match(sql, /add column if not exists amount_brl/);
  assert.match(sql, /create index if not exists card_purchases_foreign_currency_idx/);
  assert.match(sql, /create or replace function public\.backfill_foreign_card_movements/);
});
