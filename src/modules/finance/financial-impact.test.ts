import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  calculateAnalyticalExpenseSummary,
  calculateFinancialImpactSummary,
  calculateProjectedAvailableIncome,
  calculateRealizedCashFlow,
  resolveCommitmentFinancialEffects,
  type FinancialImpactItem,
} from "./financial-impact";

const income = (
  expectedCents: number,
  realizedCents = expectedCents,
): FinancialImpactItem => ({
  ...resolveCommitmentFinancialEffects({
    direction: "income",
    incomeBasis: "net",
  }),
  expectedCents,
  realizedCents,
  status: realizedCents ? "received" : "expected",
});

const expense = (
  expectedCents: number,
  options: {
    realizedCents?: number;
    payroll?: boolean;
    channel?: "bank" | "card" | "manual";
    status?: string;
  } = {},
): FinancialImpactItem => ({
  ...resolveCommitmentFinancialEffects({
    direction: "expense",
    paymentMethod: options.payroll
      ? "payroll"
      : options.channel === "card" ? "credit_card" : "bank_debit",
    isPayrollDeduction: options.payroll,
    paymentChannel: options.channel,
  }),
  expectedCents,
  realizedCents: options.realizedCents ?? 0,
  status: options.status ?? "expected",
});

test("salário líquido entra integralmente e folha não é deduzida outra vez", () => {
  const result = calculateFinancialImpactSummary([
    income(1_081_604),
    expense(243_150, { payroll: true, realizedCents: 243_150 }),
    expense(140_375, { payroll: true, realizedCents: 140_375 }),
    expense(300_000, {
      realizedCents: 300_000,
      status: "paid",
      channel: "bank",
    }),
  ]);
  assert.deepEqual(result, {
    netIncomeExpected: 1_081_604,
    netIncomeReceived: 1_081_604,
    cashExpensesExpected: 0,
    cashExpensesRealized: 300_000,
    payrollDeductions: 383_525,
    projectedAvailable: 1_081_604,
    realizedAvailable: 781_604,
    analyticalExpensesTotal: 683_525,
  });
});

test("planejamento usa renda líquida e mostra folha apenas informativamente", () => {
  const result = calculateProjectedAvailableIncome([
    income(1_300_000, 0),
    expense(350_000, { payroll: true }),
    expense(300_000, { channel: "bank" }),
    expense(200_000, { channel: "card" }),
  ]);
  assert.equal(result.expectedNetIncome, 1_300_000);
  assert.equal(result.expectedBankExpenses, 300_000);
  assert.equal(result.expectedCardExpenses, 200_000);
  assert.equal(result.payrollDeductionsInformational, 350_000);
  assert.equal(result.projectedAvailableAmount, 800_000);
});

test("pensão, consignado e sindicato em folha são despesas analíticas", () => {
  const rows = [243_150, 140_375, 10_000].map(value =>
    expense(value, { payroll: true, realizedCents: value })
  );
  const result = calculateAnalyticalExpenseSummary(rows);
  assert.equal(result.cashExpenses, 0);
  assert.equal(result.payrollDeductions, 393_525);
  assert.equal(result.analyticalExpensesTotal, 393_525);
});

test("despesa bancária reduz e pagamento realizado sai da previsão", () => {
  const result = calculateFinancialImpactSummary([
    income(500_000),
    expense(120_000, {
      realizedCents: 120_000,
      status: "paid",
      channel: "bank",
    }),
  ]);
  assert.equal(result.cashExpensesExpected, 0);
  assert.equal(result.cashExpensesRealized, 120_000);
  assert.equal(result.realizedAvailable, 380_000);
});

test("compra de cartão reduz competência sem duplicar pagamento de fatura", () => {
  const competence = calculateFinancialImpactSummary([
    income(500_000),
    expense(80_000, {
      realizedCents: 80_000,
      status: "paid",
      channel: "card",
    }),
  ]);
  const cash = calculateRealizedCashFlow([
    {
      amountCents: 80_000,
      cashFlowEffect: "outflow",
      kind: "card_invoice_payment",
    },
  ]);
  assert.equal(competence.cashExpensesRealized, 80_000);
  assert.equal(cash.cardInvoicePayments, 80_000);
  assert.equal(cash.bankOutflows, 80_000);
});

test("fluxo de caixa exclui folha e preserva transferências e investimentos", () => {
  const result = calculateRealizedCashFlow([
    { amountCents: 1_000_000, cashFlowEffect: "inflow" },
    { amountCents: 200_000, cashFlowEffect: "outflow" },
    {
      amountCents: 150_000,
      cashFlowEffect: "none",
      kind: "payroll_deduction",
    },
    { amountCents: 50_000, cashFlowEffect: "outflow", kind: "transfer" },
    {
      amountCents: 30_000,
      cashFlowEffect: "outflow",
      kind: "investment_application",
    },
  ]);
  assert.equal(result.payrollDeductionsExcluded, 150_000);
  assert.equal(result.bankOutflows, 280_000);
  assert.equal(result.netCashFlow, 720_000);
});

test("renda bancária, mediana e override permanecem líquidos", () => {
  for (const source of ["movement", "manual", "pluggy"]) {
    const effects = resolveCommitmentFinancialEffects({
      direction: "income",
      incomeBasis: source === "movement" ? "net" : undefined,
    });
    assert.equal(effects.incomeBasis, "net");
    assert.equal(effects.planningEffect, "increase");
  }
});

test("migration classifica folha, preserva RLS e diagnostica duplicidade", () => {
  const sql = readFileSync(join(
    process.cwd(),
    "supabase/migrations/202607300065_net_income_and_payroll_financial_effects.sql",
  ), "utf8");
  assert.match(sql, /cash_flow_effect = 'none'/);
  assert.match(sql, /planning_effect = 'informational'/);
  assert.match(sql, /analytics_effect = 'expense'/);
  assert.match(sql, /income_basis = case[\s\S]*'net'/);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /payroll_deduction_duplicate_diagnostics/);
  assert.doesNotMatch(sql, /delete from public\.financial_transactions/i);
  assert.match(sql, /add column if not exists/);
});
