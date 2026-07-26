import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/202607250021_monthly_result_classification.sql",
  ),
  "utf8",
);

test("migration reclassifica sem excluir histórico financeiro", () => {
  assert.doesNotMatch(migration, /\bdelete\s+from\b/i);
  assert.doesNotMatch(migration, /\btruncate\b/i);
  assert.match(migration, /transaction_role = 'cash_flow'/);
  assert.match(migration, /cash_flow_kind = 'loan_proceeds'/);
  assert.match(migration, /investment_redemption/);
  assert.match(migration, /investment_contribution/);
});

test("migration transforma tarifa em despesa e não duplica consumo", () => {
  assert.match(migration, /transaction_type = 'expense'/);
  assert.match(migration, /transaction_role = 'consumption'/);
  assert.match(migration, /\(tarifa\|encargo\|fee\|juros\|multa\)/);
});

test("migration cria índices mensais por proprietário e workspace", () => {
  assert.match(
    migration,
    /financial_transactions\(owner_id, workspace_id, competence_date, status, transaction_role\)/,
  );
  assert.match(
    migration,
    /card_purchases\(owner_id, workspace_id, competence_date, status, transaction_role\)/,
  );
});
