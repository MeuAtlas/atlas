import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/202607280043_create_pix_people_reimbursements.sql",
), "utf8");
const triggerFix = readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/202607280044_fix_person_reimbursement_scope_trigger.sql",
), "utf8");

test("migration cria as cinco estruturas do domínio", () => {
  for (const table of [
    "person_counterparties",
    "expense_allocations",
    "financial_reimbursements",
    "reimbursement_allocations",
    "person_transaction_match_suggestions",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
});

test("migration ativa RLS e cria policies separadas por operação", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /for select to authenticated/);
  assert.match(migration, /for insert to authenticated/);
  assert.match(migration, /for update to authenticated/);
  assert.match(migration, /for delete to authenticated/);
  assert.match(migration, /public\.is_workspace_member\(workspace_id\)/);
  assert.match(migration, /public\.can_edit_workspace\(workspace_id\)/);
});

test("migration protege invariantes de reembolso e deduplicação", () => {
  assert.match(migration, /validate_reimbursement_allocation_amount/);
  assert.match(migration, /exceeds reimbursement amount/);
  assert.match(migration, /exceeds reimbursable amount/);
  assert.match(migration, /financial_reimbursements_incoming_transaction_idx/);
  assert.match(migration, /unique \(reimbursement_id, expense_allocation_id\)/);
  assert.match(migration, /expense_allocations_source_person_role_idx/);
});

test("migration garante self, direção e efeito neutro de renda", () => {
  assert.match(migration, /financial_people_one_self_per_workspace_idx/);
  assert.match(migration, /'Eu', 'self'/);
  assert.match(migration, /person_flow_role/);
  assert.match(migration, /income_effect/);
  assert.match(migration, /reimbursement_received/);
});

test("migration gera fixed plus remainder nas ocorrências", () => {
  assert.match(migration, /create_shared_occurrence_allocations/);
  assert.match(migration, /when 'fixed_amount'/);
  assert.match(migration, /else greatest\(gross - user_amount, 0\)/);
  assert.match(migration, /shared_occurrence_create_allocations/);
});

test("migration não possui colunas para identificadores Pix completos", () => {
  assert.doesNotMatch(migration, /\bpix_key\s+text/);
  assert.doesNotMatch(migration, /\btax_number\s+text/);
  assert.match(migration, /pix_key_hash text/);
  assert.match(migration, /masked_pix_key text/);
});

test("correção do trigger só acessa colunas específicas dentro da tabela correta", () => {
  assert.match(
    triggerFix,
    /if tg_table_name = 'financial_reimbursements' then\s+if new\.incoming_transaction_id is not null then/,
  );
  assert.doesNotMatch(
    triggerFix,
    /tg_table_name = 'financial_reimbursements'\s+and new\.incoming_transaction_id/,
  );
  assert.match(
    triggerFix,
    /if tg_table_name = 'expense_allocations' then\s+if new\.source_transaction_id is not null then/,
  );
});
