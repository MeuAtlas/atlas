import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getCanonicalFinancialEventsForMonth,
  getExpenseContextDistribution,
  getIncomeExpenseDashboard,
  getMonthlyIncomeExpenseCumulativeSeries,
} from "./income-expense-dashboard";
import type { IncomeExpenseListItem } from "./income-expenses-query";

const item = (patch: Partial<IncomeExpenseListItem>): IncomeExpenseListItem => ({
  id: "commitment-1",
  occurrenceId: "occurrence-1",
  categoryId: null,
  accountId: null,
  cardId: null,
  personId: null,
  title: "Item",
  description: null,
  direction: "expense",
  recurrenceFrequency: "monthly",
  expectedDateDay: 10,
  estimationMethod: "fixed",
  aggregationMode: "single_occurrence",
  contextType: "personal",
  status: "active",
  expectedAmountCents: 10000,
  realizedAmountCents: 0,
  differenceCents: -10000,
  occurrenceStatus: "projected",
  competenceMonth: "2026-07-01",
  expectedDate: "2026-07-10",
  paymentDate: null,
  paymentMethod: null,
  paymentSourceName: null,
  settlementSource: null,
  linkedInvoiceId: null,
  linkedTransactionId: null,
  creditsCount: 0,
  historicalMedianCents: null,
  historicalAverageCents: null,
  historicalMonthsCount: 0,
  incomeBasis: null,
  cashFlowEffect: "outflow",
  planningEffect: "decrease",
  analyticsEffect: "expense",
  paymentChannel: "bank",
  isPayrollDeduction: false,
  categoryName: null,
  personNames: [],
  ...patch,
});

test("dashboard calcula os quatro indicadores sem descontar folha novamente", () => {
  const income = item({ id: "income", occurrenceId: "income-occ", direction: "income", expectedAmountCents: 200000, realizedAmountCents: 150000 });
  const expense = item({ id: "expense", occurrenceId: "expense-occ", expectedAmountCents: 80000, realizedAmountCents: 50000 });
  const payroll = item({ id: "payroll", occurrenceId: "payroll-occ", expectedAmountCents: 30000, realizedAmountCents: 30000, isPayrollDeduction: true });
  const dashboard = getIncomeExpenseDashboard({ month: "2026-07-01", incomes: [income], expenses: [expense], payrollDeductions: [payroll] });
  assert.equal(dashboard.summary.realizedResult, 100000);
  assert.equal(dashboard.summary.projectedResult, 120000);
  assert.equal(dashboard.summary.remainingExpectedExpenses, 30000);
  assert.equal(dashboard.summary.payrollDeductionsTotal, 30000);
});

test("eventos usam identificador canônico e removem duplicidade e folha", () => {
  const first = item({ occurrenceId: "same-occurrence" });
  const duplicate = item({ id: "other", occurrenceId: "same-occurrence" });
  const payroll = item({ id: "payroll", occurrenceId: "payroll", isPayrollDeduction: true });
  assert.equal(getCanonicalFinancialEventsForMonth([first, duplicate, payroll]).length, 1);
});

test("série acumulada preenche dias sem movimento", () => {
  const income = item({ direction: "income", paymentDate: "2026-07-05", realizedAmountCents: 100000 });
  const expense = item({ id: "expense", occurrenceId: "expense", paymentDate: "2026-07-10", realizedAmountCents: 25000 });
  const series = getMonthlyIncomeExpenseCumulativeSeries({ month: "2026-07-01", items: [income, expense] });
  assert.equal(series.length, 31);
  assert.equal(series[4]?.cumulativeIncome, 100000);
  assert.equal(series[8]?.cumulativeExpenses, 0);
  assert.equal(series[9]?.cumulativeExpenses, 25000);
});

test("distribuição prioriza dependentes e usa somente despesas pagas", () => {
  const dependent = item({ realizedAmountCents: 50000, personNames: ["Anna"], contextType: "personal" });
  const house = item({ id: "house", occurrenceId: "house", realizedAmountCents: 50000, contextType: "household" });
  const projected = item({ id: "future", occurrenceId: "future", realizedAmountCents: 0, contextType: "work" });
  const distribution = getExpenseContextDistribution([dependent, house, projected]);
  assert.deepEqual(distribution.map(entry => [entry.key, entry.percentage]), [["household", 50], ["dependents", 50]]);
});

test("rota renderiza o novo dashboard e remove a visão geral antiga", () => {
  const workspace = readFileSync(join(process.cwd(), "src/components/finance/income-expenses/income-expenses-workspace.tsx"), "utf8");
  const dashboard = readFileSync(join(process.cwd(), "src/components/finance/income-expenses/income-expense-dashboard.tsx"), "utf8");
  const shell = readFileSync(join(process.cwd(), "src/components/finance/finance-shell.tsx"), "utf8");
  assert.match(workspace, /IncomeExpenseDashboardView/);
  assert.doesNotMatch(workspace, /FlowSummary/);
  assert.match(dashboard, /ied-kpi-grid/);
  assert.match(dashboard, /monthly-cash-flow-chart/);
  assert.match(dashboard, /financial-events-panel/);
  assert.match(dashboard, /payroll-deductions-summary/);
  assert.match(dashboard, /expense-context-distribution/);
  assert.match(dashboard, /top-income-list/);
  assert.match(dashboard, /top-expense-list/);
  assert.doesNotMatch(shell, /Nova movimentação/);
});
