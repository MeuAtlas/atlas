import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMonthlyFinancialResult,
  financialCompetenceDate,
  getFinanceMonthPeriod,
  resolveFinanceMonthPeriod,
  shiftFinanceMonth,
} from "./monthly-result";
import type { CardPurchase, FinancialTransaction } from "./types";

const july = getFinanceMonthPeriod({
  year: 2026,
  month: 7,
  timeZone: "America/Sao_Paulo",
});

const transaction = (
  partial: Partial<FinancialTransaction> = {},
): FinancialTransaction => ({
  id: crypto.randomUUID(),
  external_id: null,
  description: "Movimentação",
  amount: 100,
  transaction_type: "expense",
  transaction_role: "cash_flow",
  source_type: "manual",
  financial_origin: "bank_account",
  cash_flow_kind: "expense",
  status: "realized",
  competence_date: "2026-07-10",
  due_date: null,
  realized_at: "2026-07-10T12:00:00Z",
  source: "manual",
  visibility: "private",
  account_id: "account",
  destination_account_id: null,
  category_id: null,
  workspace_id: null,
  review_status: "reviewed",
  ...partial,
});

const purchase = (
  partial: Partial<CardPurchase> = {},
): CardPurchase => ({
  id: crypto.randomUUID(),
  external_id: null,
  card_id: "card",
  invoice_id: null,
  description: "Compra",
  total_amount: 6_000,
  total_purchase_amount: 6_000,
  installment_amount: 500,
  purchase_date: "2026-07-10",
  competence_date: "2026-07-10",
  installment_number: 3,
  installment_count: 12,
  source: "pluggy",
  source_type: "card",
  financial_origin: "credit_card",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: null,
  bill_forecast_date: null,
  provider_category: null,
  merchant: null,
  visibility: "private",
  workspace_id: null,
  category_id: null,
  ...partial,
});

const calculate = (
  transactions: FinancialTransaction[],
  purchases: CardPurchase[] = [],
  workspaceId: string | null = null,
) =>
  calculateMonthlyFinancialResult({
    transactions,
    purchases,
    period: july,
    scope: { workspaceId },
  });

test("resultado positivo é receita reconhecida menos despesa reconhecida", () => {
  const result = calculate([
    transaction({ transaction_type: "income", amount: 20_000 }),
    transaction({ amount: 16_500 }),
  ]);
  assert.equal(result.realizedRevenue, 20_000);
  assert.equal(result.realizedExpenses, 16_500);
  assert.equal(result.monthlyResult, 3_500);
});

test("resultado negativo e resultado zero preservam o sinal", () => {
  assert.equal(
    calculate([
      transaction({ transaction_type: "income", amount: 15_000 }),
      transaction({ amount: 18_000 }),
    ]).monthlyResult,
    -3_000,
  );
  assert.equal(
    calculate([
      transaction({ transaction_type: "income", amount: 1_000 }),
      transaction({ amount: 1_000 }),
    ]).monthlyResult,
    0,
  );
});

test("transferência e pagamento de fatura nunca alteram o resultado", () => {
  const result = calculate([
    transaction({
      transaction_type: "transfer",
      transaction_role: "transfer",
      destination_account_id: "destination",
      amount: 2_000,
    }),
    transaction({
      transaction_type: "transfer",
      transaction_role: "invoice_payment",
      credit_card_id: "card",
      amount: 3_000,
    }),
    transaction({ transaction_type: "income", amount: 10_000 }),
    transaction({ amount: 7_000 }),
  ]);
  assert.equal(result.monthlyResult, 3_000);
});

test("compra parcelada usa somente installment_amount e não total_amount", () => {
  const result = calculate([], [purchase()]);
  assert.equal(result.realizedExpenses, 500);
  assert.equal(result.monthlyResult, -500);
});

test("desconto em folha é analítico sem reduzir novamente o resultado", () => {
  const result = calculate([
    transaction({
      account_id: null,
      loan_id: "loan",
      source: "manual_loan",
      source_type: "payroll",
      payment_source: "payroll",
      transaction_role: "consumption",
      financial_origin: "adjustment",
      cash_flow_kind: "payroll_loan",
      amount: 1_000,
    }),
  ]);
  assert.equal(result.realizedExpenses, 0);
  assert.equal(result.payrollDeductions, 1_000);
  assert.equal(result.analyticalExpenses, 1_000);
  assert.equal(result.monthlyResult, 0);
});

test("crédito de empréstimo e principal de investimento são excluídos", () => {
  const result = calculate([
    transaction({
      transaction_type: "income",
      cash_flow_kind: "loan_proceeds",
      amount: 20_000,
    }),
    transaction({
      transaction_type: "expense",
      transaction_role: "adjustment",
      cash_flow_kind: "investment_contribution",
      amount: 4_000,
    }),
    transaction({
      transaction_type: "income",
      transaction_role: "adjustment",
      cash_flow_kind: "investment_redemption",
      amount: 5_000,
    }),
    transaction({
      transaction_type: "income",
      description: "Rendimento",
      cash_flow_kind: "income",
      amount: 300,
    }),
  ]);
  assert.equal(result.realizedRevenue, 300);
  assert.equal(result.realizedExpenses, 0);
});

test("estorno reduz a despesa e não vira receita comum", () => {
  const result = calculate(
    [
      transaction({ amount: 500 }),
      transaction({
        transaction_type: "refund",
        transaction_role: "refund",
        cash_flow_kind: "refund",
        amount: 200,
      }),
    ],
    [purchase({ installment_amount: 100 }), purchase({
      transaction_role: "refund",
      installment_amount: 100,
    })],
  );
  assert.equal(result.realizedRevenue, 0);
  assert.equal(result.realizedExpenses, 300);
});

test("cancelados, pendentes de revisão e previstos não entram no realizado", () => {
  const result = calculate([
    transaction({ status: "cancelled", amount: 900 }),
    transaction({ review_status: "pending", amount: 800 }),
    transaction({
      status: "forecast",
      transaction_type: "income",
      amount: 700,
    }),
  ]);
  assert.equal(result.realizedExpenses, 0);
  assert.equal(result.expectedRevenue, 700);
});

test("deduplica registros importados pela chave source e external_id", () => {
  const duplicated = {
    external_id: "provider-1",
    source: "pluggy",
    transaction_type: "income" as const,
    amount: 1_000,
  };
  const result = calculate([
    transaction(duplicated),
    transaction(duplicated),
  ]);
  assert.equal(result.realizedRevenue, 1_000);
});

test("escopo privado não mistura workspace e compartilhado usa somente o workspace", () => {
  const privateIncome = transaction({
    transaction_type: "income",
    amount: 100,
  });
  const sharedIncome = transaction({
    transaction_type: "income",
    amount: 250,
    visibility: "workspace",
    workspace_id: "shared",
  });
  assert.equal(calculate([privateIncome, sharedIncome]).realizedRevenue, 100);
  assert.equal(
    calculate([privateIncome, sharedIncome], [], "shared").realizedRevenue,
    250,
  );
});

test("períodos cobrem 28, 29, 30 e 31 dias com fim exclusivo", () => {
  assert.equal(
    getFinanceMonthPeriod({ year: 2025, month: 2 }).endExclusiveDate,
    "2025-03-01",
  );
  assert.equal(
    getFinanceMonthPeriod({ year: 2024, month: 2 }).endExclusiveDate,
    "2024-03-01",
  );
  assert.equal(
    getFinanceMonthPeriod({ year: 2026, month: 4 }).endExclusiveDate,
    "2026-05-01",
  );
  assert.equal(july.endExclusiveDate, "2026-08-01");
});

test("mudança de ano e mês anterior são calculados pela mesma função", () => {
  const december = getFinanceMonthPeriod({ year: 2026, month: 12 });
  assert.equal(december.endExclusiveDate, "2027-01-01");
  assert.equal(shiftFinanceMonth(december, -1).key, "2026-11");
  assert.equal(
    shiftFinanceMonth(
      getFinanceMonthPeriod({ year: 2026, month: 1 }),
      -1,
    ).key,
    "2025-12",
  );
});

test("timezone brasileiro define instantes UTC sem deslocar a competência", () => {
  assert.equal(july.startInstant, "2026-07-01T03:00:00.000Z");
  assert.equal(july.endExclusiveInstant, "2026-08-01T03:00:00.000Z");
  assert.equal(
    resolveFinanceMonthPeriod({
      referenceDate: new Date("2026-08-01T01:30:00Z"),
      timeZone: "America/Sao_Paulo",
    }).key,
    "2026-07",
  );
});

test("prioridade de competência usa realized_at antes de created_at", () => {
  assert.equal(
    financialCompetenceDate({
      competence_date: null,
      realized_at: "2026-07-31T23:30:00-03:00",
      created_at: "2026-08-01T10:00:00Z",
    }),
    "2026-07-31",
  );
});
