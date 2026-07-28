import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/202607280037_unify_open_card_invoice.sql",
  "utf8",
);

test("migration cria total canônico sem remover aliases legados", () => {
  assert.match(sql, /add column if not exists confirmed_open_total/);
  assert.match(sql, /confirmed_open_total_at/);
  assert.match(sql, /confirmed_open_total_source/);
  assert.match(sql, /current_display_total=coalesce\(\s*new\.confirmed_open_total/);
  assert.doesNotMatch(sql, /drop column/);
});

test("backfill é autenticado, idempotente e possui dry-run", () => {
  assert.match(sql, /backfill_open_card_invoice_totals/);
  assert.match(sql, /p_apply boolean default false/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /is distinct from/);
  assert.match(sql, /'mode',case when p_apply then 'apply' else 'dry-run'/);
});
