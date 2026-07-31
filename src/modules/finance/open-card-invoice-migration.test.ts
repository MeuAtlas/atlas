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

test("migration 074 usa o maior valor entre confirmação e estimativa", () => {
  const policy = readFileSync(
    "supabase/migrations/202607300074_invoice_history_and_open_total_policy.sql",
    "utf8",
  );
  assert.match(
    policy,
    /greatest\(\s*new\.confirmed_open_total,\s*new\.manual_invoice_total,\s*new\.confirmed_invoice_total,\s*new\.calculated_invoice_total\s*\)/,
  );
  assert.match(
    policy,
    /new\.source='pluggy_bill'[\s\S]*new\.total_source='provider_bill'/,
  );
  assert.match(policy, /where status='open'/);
});
