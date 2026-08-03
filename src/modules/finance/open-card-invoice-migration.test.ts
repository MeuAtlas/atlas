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

test("migration 097 restaura e preserva snapshot maior durante parcial", () => {
  const policy = readFileSync(
    "supabase/migrations/202608030097_preserve_newer_open_statement_on_partial_bill.sql",
    "utf8",
  );
  assert.match(policy, /partial_bank_reduction/);
  assert.match(policy, /new\.data_completeness='partial'/);
  assert.match(policy, /bank_total<baseline/);
  assert.match(policy, /partial_bill_lower_than_reliable_snapshot/);
  assert.match(policy, /credit_card_statement_value_history/);
  assert.match(policy, /history\.previous_display_total_amount>history\.new_display_total_amount/);
  assert.doesNotMatch(policy, /delete from public\.(card_invoices|credit_card_statement_value_history)/i);
});

test("migration 098 repara somente a transição conhecida do incidente", () => {
  const repair = readFileSync(
    "supabase/migrations/202608030098_restore_incident_open_statement_snapshot.sql",
    "utf8",
  );
  assert.match(repair, /id='0219faee-6359-4071-ac45-8a0fa3423764'::uuid/);
  assert.match(repair, /current_display_total=7082\.45/);
  assert.match(repair, /last_reliable_invoice_total=7082\.45/);
  assert.match(repair, /current_display_total=7669\.72/);
  assert.match(repair, /data_completeness='partial'/);
  assert.doesNotMatch(repair, /delete from public\./i);
});

test("migration 099 remove somente aliases de confirmação incoerentes", () => {
  const repair = readFileSync(
    "supabase/migrations/202608030099_clear_stale_incident_confirmation_aliases.sql",
    "utf8",
  );
  assert.match(repair, /source='calculated'/);
  assert.match(repair, /total_source='calculated_transactions'/);
  assert.match(repair, /provider_invoice_total is null/);
  assert.match(repair, /manual_invoice_total=null/);
  assert.match(repair, /confirmed_invoice_total=null/);
  assert.match(repair, /current_display_total=7669\.72/);
  assert.doesNotMatch(repair, /delete from public\./i);
});
