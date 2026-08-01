import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { FinanceOverviewInvoice } from "./finance-overview-dashboard";
import type { IncomeExpenseListItem, IncomeExpensePageData } from "./income-expenses-query";
import {
  buildPlanningDashboard,
  getFinancialPlanningProjectionSeries,
  getPlanningAttentionItems,
  getPlanningNextMonthSummary,
  resolveCanonicalPlanningItems,
} from "./planning-dashboard";
import { planningCacheTag, planningDependencyTags } from "./commitments-cache";

const item = (patch: Partial<IncomeExpenseListItem> = {}): IncomeExpenseListItem => ({
  id: "item", occurrenceId: "occurrence", categoryId: null, accountId: null,
  cardId: null, personId: null, title: "Item", description: null,
  direction: "expense", recurrenceFrequency: "monthly", expectedDateDay: 10,
  estimationMethod: "fixed", aggregationMode: "single_occurrence", contextType: "personal",
  status: "active", expectedAmountCents: 10000, realizedAmountCents: 0,
  differenceCents: -10000, occurrenceStatus: "projected", competenceMonth: "2026-08-01",
  expectedDate: "2026-08-10", paymentDate: null, paymentMethod: "pix",
  paymentSourceName: null, settlementSource: null, linkedInvoiceId: null,
  linkedTransactionId: null, creditsCount: 0, historicalMedianCents: null,
  historicalAverageCents: null, historicalMonthsCount: 0, incomeBasis: null,
  cashFlowEffect: "outflow", planningEffect: "decrease", analyticsEffect: "expense",
  paymentChannel: "bank", isPayrollDeduction: false, budgetPriority: "unknown",
  categoryName: null, personNames: [], ...patch,
});

const flow = (month = "2026-08", items: IncomeExpenseListItem[] = []): IncomeExpensePageData => ({
  workspaceId: "workspace", month: `${month}-01`,
  incomes: items.filter(value => value.direction === "income"),
  expenses: items.filter(value => value.direction === "expense" && !value.isPayrollDeduction),
  payrollDeductions: items.filter(value => value.isPayrollDeduction),
  upcoming: items.filter(value => !value.isPayrollDeduction),
  overview: { expectedIncomeCents: 0, receivedIncomeCents: 0, expectedExpenseCents: 0, paidExpenseCents: 0, projectedBalanceCents: 0, realizedBalanceCents: 0 },
  dashboard: { summary: {} as IncomeExpensePageData["dashboard"]["summary"], cumulativeSeries: [], financialEvents: [], contextDistribution: [], topIncome: [], topExpenses: [], warnings: [] },
});

const income = (amount: number, patch: Partial<IncomeExpenseListItem> = {}) => item({
  id: `income-${amount}`, occurrenceId: `income-${amount}`, title: "Receita",
  direction: "income", expectedAmountCents: Math.round(amount * 100),
  differenceCents: Math.round(amount * -100), incomeBasis: "net", cashFlowEffect: "inflow",
  planningEffect: "increase", analyticsEffect: "income", ...patch,
});
const expense = (amount: number, patch: Partial<IncomeExpenseListItem> = {}) => item({
  id: `expense-${amount}`, occurrenceId: `expense-${amount}`, title: "Despesa",
  expectedAmountCents: Math.round(amount * 100), differenceCents: Math.round(amount * -100), ...patch,
});
const invoice = (amount: number, patch: Partial<FinanceOverviewInvoice> = {}): FinanceOverviewInvoice => ({
  id: "invoice", name: "Mastercard", lastFour: "1234", amount,
  ownerPayableAmount: amount, status: "open", closingDate: "2026-08-01",
  dueDate: "2026-08-10", partial: false, sourceLabel: "Total sincronizado",
  confidence: "high", href: "/financeiro/cartoes", ...patch,
});
const canonical = (amount: number, kind: "income" | "expense" = "expense") => ({
  canonicalId: `${kind}:${amount}`, kind, source: "fixed", title: kind,
  expectedAmount: amount, realizedAmount: 0, planningAmount: amount, cashEffect: true,
  includedInInvoice: false, includedInOtherTotal: false, deduplicationReason: null,
  expectedDate: "2026-08-10", method: "fixed", paymentMethod: "pix", context: "Pessoal",
  priority: "essential" as const, confidence: "high" as const,
});

test("1. receitas previstas usam o valor ainda não realizado", () => {
  const result = resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(1000, { realizedAmountCents: 25000 })]) });
  assert.equal(result[0]?.planningAmount, 750);
});
test("2. despesas previstas usam o valor ainda não pago", () => {
  const result = resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(500, { realizedAmountCents: 12000 })]) });
  assert.equal(result[0]?.planningAmount, 380);
});
test("3. livre estimado é receita menos despesa", () => assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(1000, "income"), canonical(400)] }).estimatedFreeAmount, 600));
test("4. comprometimento usa a renda líquida", () => assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(1000, "income"), canonical(790)] }).committedPercentage, 79));
test("5. renda zero não produz divisão inválida", () => assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(100)] }).committedPercentage, null));
test("6. resultado negativo é preservado", () => assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(100, "income"), canonical(200)] }).estimatedFreeAmount, -100));
test("7. resultado positivo é preservado", () => assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(250, "income"), canonical(100)] }).estimatedFreeAmount, 150));
test("8. receita fixa mantém método", () => assert.equal(resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(100)]) })[0]?.method, "fixed"));
test("9. receita por mediana mantém método e confiança", () => {
  const result = resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(100, { estimationMethod: "historical_median", historicalMonthsCount: 6 })]) });
  assert.equal(result[0]?.method, "historical_median"); assert.equal(result[0]?.confidence, "medium");
});
test("10. override manual é identificado", () => assert.equal(resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(100, { estimationMethod: "manual" })]) })[0]?.method, "manual"));
test("11. menos de três meses reduz confiança da mediana", () => assert.equal(resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(100, { estimationMethod: "historical_median", historicalMonthsCount: 2 })]) })[0]?.confidence, "low"));
test("12. fatura confiável entra uma única vez", () => assert.equal(resolveCanonicalPlanningItems({ flow: flow(), invoices: [invoice(7389.22)] }).filter(value => value.kind === "invoice")[0]?.planningAmount, 7389.22));
test("13. fatura parcial preserva qualidade e valor", () => {
  const result = resolveCanonicalPlanningItems({ flow: flow(), invoices: [invoice(7389.22, { partial: true })] })[0];
  assert.equal(result?.planningAmount, 7389.22); assert.match(result?.dataQuality ?? "", /parciais/);
});
test("14. desconto em folha é informativo e não reduz o livre", () => {
  const payroll = expense(5633.23, { id: "payroll", occurrenceId: "payroll", isPayrollDeduction: true });
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [income(16240.38), expense(12833.23), payroll]) });
  assert.equal(items.find(value => value.kind === "payroll")?.planningAmount, 0);
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).estimatedFreeAmount, 3407.15);
});
test("15. parcela não soma novamente quando há fatura", () => {
  const items = resolveCanonicalPlanningItems({ flow: flow(), invoices: [invoice(7389.22)], monthlyCommitments: { competenceMonth: "2026-08", recurringTotalCents: 0, installmentTotalCents: 100000, loanTotalCents: 0, payrollTotalCents: 0, oneTimeTotalCents: 0, totalCommittedCents: 100000, confirmedTotalCents: 100000, projectedTotalCents: 0, sourceCounts: {} } });
  assert.equal(items.some(value => value.kind === "installment"), false);
});
test("16. compromisso pago antecipado não entra", () => assert.equal(resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { occurrenceStatus: "paid" })]) }).length, 0));
test("17. transferência interna sem efeito de caixa não altera total", () => {
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { cashFlowEffect: "none" })]) });
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).expectedExpenses, 0);
});
test("18. aplicação sem efeito de caixa não altera total", () => {
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { cashFlowEffect: "none", title: "Aplicação" })]) });
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).estimatedFreeAmount, 0);
});
test("19. dependente alimenta o agregado", () => {
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { personNames: ["Anna"] })]) });
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).dependentsAmount, 100);
});
test("20. contexto casa alimenta o agregado", () => {
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { contextType: "household" })]) });
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).householdAmount, 100);
});
for (const [number, value] of [[21, "essential"], [22, "adjustable"], [23, "optional"], [24, "unclassified"]] as const) test(`${number}. prioridade ${value} aparece na composição`, () => {
  const priority = value === "unclassified" ? "unknown" : value;
  assert.equal(resolveCanonicalPlanningItems({ flow: flow("2026-08", [expense(100, { budgetPriority: priority })]) })[0]?.priority, value);
});
for (const [number, horizon] of [[25, 3], [26, 6], [27, 12]] as const) test(`${number}. projeção de ${horizon} meses mantém o horizonte`, () => {
  const months = Array.from({ length: horizon }, (_, index) => ({ month: `2026-${String(index + 1).padStart(2, "0")}`, items: [canonical(100, "income")] }));
  assert.equal(getFinancialPlanningProjectionSeries(months).length, horizon);
});
test("28. alertas são acionáveis para resultado negativo", () => {
  const summary = getPlanningNextMonthSummary({ month: "2026-08", items: [canonical(100, "income"), canonical(200)] });
  assert.ok(getPlanningAttentionItems(summary, [canonical(100, "income"), canonical(200)]).every(value => value.href && value.actionLabel));
});
test("29. cache contém chave filtrada e todas as dependências", () => {
  assert.equal(planningCacheTag("workspace", "2026-08", 6), "finance:planning:workspace:2026-08:6");
  const tags = planningDependencyTags("workspace", "2026-08", 6);
  for (const resource of ["income", "expenses", "cards", "bills", "commitments", "people", "accounts"]) assert.ok(tags.some(tag => tag.includes(resource)));
});
test("30. RLS de prioridade mantém workspace e autenticação", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/202607300061_simplify_financial_commitments_creation.sql"), "utf8");
  assert.match(migration, /workspace_id/); assert.match(migration, /auth\.uid\(\)/);
});
test("cenário principal de agosto de 2026 preserva os quatro resultados", () => {
  const payroll = expense(5633.23, { id: "payroll", occurrenceId: "payroll", isPayrollDeduction: true });
  const dashboard = buildPlanningDashboard({ workspaceId: "workspace", startMonth: "2026-08", horizon: 6, accountId: null, accounts: [], months: [{ flow: flow("2026-08", [income(16240.38), expense(12833.23), payroll]) }] });
  assert.equal(dashboard.nextMonthSummary.expectedIncome, 16240.38);
  assert.equal(dashboard.nextMonthSummary.expectedExpenses, 12833.23);
  assert.equal(dashboard.nextMonthSummary.estimatedFreeAmount, 3407.15);
  assert.ok(Math.abs((dashboard.nextMonthSummary.committedPercentage ?? 0) - 79.02) < 0.01);
  assert.equal(dashboard.payrollDeductionsInformational[0]?.expectedAmount, 5633.23);
});
test("fatura Mastercard de R$ 7.389,22 não duplica compras de cartão", () => {
  const cardPurchase = expense(1000, { paymentChannel: "card", cardId: "card" });
  const items = resolveCanonicalPlanningItems({ flow: flow("2026-08", [cardPurchase]), invoices: [invoice(7389.22)] });
  assert.equal(items.find(value => value.kind === "expense")?.planningAmount, 0);
  assert.equal(getPlanningNextMonthSummary({ month: "2026-08", items }).expectedExpenses, 7389.22);
});
