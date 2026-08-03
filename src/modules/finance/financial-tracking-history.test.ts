import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { availableFinancialMonths, buildMonthlySnapshot, getMonthlyPeriod, isBeforeFinancialTracking } from "./monthly-financial-report";

test("histórico do usuário principal começa em julho de 2026", () => {
  assert.deepEqual(availableFinancialMonths({ year: 2026, trackingStartYear: 2026, trackingStartMonth: 7, now: new Date("2026-08-02T12:00:00Z") }), [7, 8]);
  assert.equal(isBeforeFinancialTracking({ year: 2026, month: 6, trackingStartYear: 2026, trackingStartMonth: 7 }), true);
});

test("anos e meses anteriores não geram relatórios vazios", () => {
  assert.deepEqual(availableFinancialMonths({ year: 2025, trackingStartYear: 2026, trackingStartMonth: 7, now: new Date("2026-08-02T12:00:00Z") }), []);
  assert.deepEqual(availableFinancialMonths({ year: 2027, trackingStartYear: 2026, trackingStartMonth: 7, now: new Date("2026-08-02T12:00:00Z") }), []);
});

test("primeiro mês parcial permanece identificado no snapshot", () => {
  const period = getMonthlyPeriod(2026, 9);
  const snapshot = buildMonthlySnapshot({ period, transactions: [], purchases: [], statements: [], allocations: [], accounts: [], status: "open", tracking: { startedAt: "2026-09-18T03:00:00.000Z", availableDataStartAt: "2026-09-18T03:00:00.000Z", isFirstFinancialReport: true, isPartialInitialMonth: true } });
  assert.equal(snapshot.tracking.isFirstFinancialReport, true);
  assert.equal(snapshot.tracking.isPartialInitialMonth, true);
  assert.equal(snapshot.tracking.availableDataStartAt, "2026-09-18T03:00:00.000Z");
});

test("migration configura julho sem reconstruir meses históricos", () => {
  const sql = readFileSync("supabase/migrations/202608020077_financial_tracking_history_start.sql", "utf8");
  assert.match(sql, /2026-07-01 00:00:00 America\/Fortaleza/);
  assert.match(sql, /report_origin[^;]+live_tracked[\s\S]+historically_reconstructed/);
  assert.match(sql, /current_report_id is null/);
});

test("compartilhamento histórico exige participação explícita", () => {
  const sql = readFileSync("supabase/migrations/202608020077_financial_tracking_history_start.sql", "utf8");
  assert.match(sql, /workspace_financial_memberships/);
  assert.match(sql, /include_in_shared_reports boolean not null default false/);
  assert.match(sql, /can_view_previous_reports boolean not null default false/);
  assert.match(sql, /person\.user_id=auth\.uid\(\)/);
});

test("primeiro evento válido registra o início, sem usar criação da conta", () => {
  const sql = readFileSync("supabase/migrations/202608020077_financial_tracking_history_start.sql", "utf8");
  assert.match(sql, /finance_module_activation/);
  assert.match(sql, /first_account_connection/);
  assert.match(sql, /manual_configuration/);
  assert.match(sql, /user_module_financial_tracking_start/);
  assert.match(sql, /bank_connection_financial_tracking_start/);
});

test("preparação para revisão corrige estado persistido antigo de forma transacional", () => {
  const sql = readFileSync("supabase/migrations/202608020078_prepare_financial_month_review.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /target\.status='open'/);
  assert.match(sql, /status='awaiting_consolidation'/);
  assert.match(sql, /status='review'/);
  assert.match(sql, /can_admin_workspace/);
});

test("lista mensal mostra somente a fatura do próprio mês de caixa", () => {
  const service = readFileSync("src/modules/finance/financial-reports-list.ts", "utf8");
  assert.match(service, /getStatementForCashMonth/);
  assert.match(service, /reconciliationStatements/);
  assert.match(service, /confirmed_payment_amount/);
  assert.doesNotMatch(service, /forecastCardInvoice/);
});

test("fatura prevista usa o ciclo de consumo do mês, não a fatura paga nele", () => {
  const query = readFileSync("src/modules/finance/monthly-financial-report-query.ts", "utf8");
  assert.match(query, /shiftFinanceMonth\(period, 1\)\.key/);
  assert.match(query, /row\.reference_month/);
  assert.doesNotMatch(query, /dueMonth \|\| closingMonth/);
});

test("fatura futura inclui parcelas projetadas ainda sem compra materializada", () => {
  const query = readFileSync("src/modules/finance/monthly-financial-report-query.ts", "utf8");
  assert.match(query, /card_installment_occurrences/);
  assert.match(query, /\["projected", "confirmed"\]/);
  assert.match(query, /unmaterializedInstallments/);
  assert.match(query, /materializedPlans/);
});

test("lista mensal usa os papéis tipográficos oficiais do Atlas", () => {
  const page = readFileSync("src/app/financeiro/relatorios/page.tsx", "utf8");
  const list = readFileSync("src/components/finance/financial-reports-list.tsx", "utf8");
  for (const variant of ["pageTitle", "pageSubtitle", "tableHeader", "tableBody", "financialValueSmall", "button"]) {
    assert.match(`${page}\n${list}`, new RegExp(`variant=\\"${variant}\\"`));
  }
});
