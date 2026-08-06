import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateExpenseEstablishmentMetrics } from "./expense-establishment-metrics";

test("estabelecimento eventual soma pagamentos e inclui mês sem uso na mediana", () => {
  const metrics = calculateExpenseEstablishmentMetrics([
    { amount: 85, date: "2026-06-10" },
    { amount: 110, date: "2026-06-20" },
    { amount: 95, date: "2026-08-02" },
  ], new Date("2026-08-04T12:00:00Z"));
  assert.equal(metrics.paymentCount, 3);
  assert.equal(metrics.currentMonthTotal, 95);
  assert.equal(metrics.last12MonthsTotal, 290);
  assert.equal(metrics.averagePayment, 290 / 3);
  assert.equal(metrics.medianMonthly, 95);
  assert.equal(metrics.observedMonths, 3);
});

test("migration protege regra, vínculo e movimentações existentes", () => {
  const migration = readFileSync(
    "supabase/migrations/202608040100_expense_establishments.sql",
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.expense_establishments/);
  assert.match(migration, /match_hash text not null/);
  assert.match(migration, /financial_transactions_apply_expense_establishment/);
  assert.match(migration, /public\.can_edit_workspace\(workspace_id\)/);
  assert.doesNotMatch(migration, /delete from public\.financial_transactions/);
});

test("migration corretiva permite inserir estabelecimento no workspace autorizado", () => {
  const migration = readFileSync(
    "supabase/migrations/202608040101_fix_expense_establishment_scope.sql",
    "utf8",
  );
  assert.match(migration, /else[\s\S]*public\.can_edit_workspace\(new\.workspace_id\)/);
  assert.match(migration, /target_workspace := new\.workspace_id/);
  assert.match(migration, /target_workspace is distinct from new\.workspace_id/);
});

test("drawer cria estabelecimento a partir do PIX sem exigir recorrência", () => {
  const browser = readFileSync(
    "src/components/finance/movements-browser.tsx",
    "utf8",
  );
  const actions = readFileSync(
    "src/modules/finance/expense-establishments-actions.ts",
    "utf8",
  );
  assert.match(browser, /Associar estabelecimento/);
  assert.doesNotMatch(browser, /Diária de referência/);
  assert.match(browser, /apply_to_history/);
  assert.match(browser, /Meses sem pagamento entram como zero na mediana/);
  assert.match(actions, /extractCounterpartyFingerprint/);
  assert.match(actions, /historical_backfill/);
  assert.match(actions, /workspace_id\.eq\.\$\{parsed\.workspaceId\},workspace_id\.is\.null/);
  assert.doesNotMatch(browser, /name="pix_key"/);
});
