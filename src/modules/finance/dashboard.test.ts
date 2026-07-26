import assert from "node:assert/strict";
import test from "node:test";
import { buildFinanceDashboard } from "./dashboard";
import type {
  BankConnectionSummary,
  CardPurchase,
  FinancialAccount,
  FinancialTransaction,
} from "./types";

const account = (
  partial: Partial<FinancialAccount> = {},
): FinancialAccount => ({
  id: crypto.randomUUID(),
  name: "Conta",
  institution_name: null,
  account_type: "checking",
  current_balance: 1000,
  opening_balance: 0,
  source: "manual",
  status: "active",
  visibility: "private",
  last_sync_at: null,
  ...partial,
});

const transaction = (
  partial: Partial<FinancialTransaction> = {},
): FinancialTransaction => ({
  id: crypto.randomUUID(),
  description: "Movimentação",
  amount: 100,
  transaction_type: "expense",
  transaction_role: "cash_flow",
  source_type: "manual",
  financial_origin: "bank_account",
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

const purchase = (partial: Partial<CardPurchase> = {}): CardPurchase => ({
  id: crypto.randomUUID(),
  card_id: "card",
  invoice_id: null,
  description: "Compra",
  total_amount: 80,
  installment_amount: 80,
  purchase_date: "2026-07-10",
  competence_date: "2026-07-10",
  installment_number: 1,
  installment_count: 1,
  source: "manual",
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
  category_id: null,
  ...partial,
});

const build = (
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[],
  purchases: CardPurchase[] = [],
  connections: BankConnectionSummary[] = [],
) =>
  buildFinanceDashboard(
    accounts,
    transactions,
    purchases,
    [],
    connections,
    new Date("2026-07-25T12:00:00Z"),
  );

test("dashboard calcula saldo disponível sem investimentos e contas arquivadas", () => {
  const result = build(
    [
      account({ current_balance: 1200 }),
      account({ account_type: "investment", current_balance: 9000 }),
      account({ status: "archived", current_balance: 500 }),
    ],
    [],
  );
  assert.equal(result.summary.available, 1200);
  assert.equal(result.activeAccountCount, 1);
});

test("dashboard calcula receitas, despesas, a pagar, a receber e projeção", () => {
  const result = build(
    [account({ current_balance: 1000 })],
    [
      transaction({ transaction_type: "income", amount: 500 }),
      transaction({ amount: 100 }),
      transaction({ status: "pending", amount: 70, due_date: "2026-07-29" }),
      transaction({
        transaction_type: "income",
        status: "forecast",
        amount: 200,
        due_date: "2026-07-30",
      }),
    ],
    [purchase({ installment_amount: 80 })],
  );
  assert.equal(result.summary.income, 500);
  assert.equal(result.summary.expenses, 180);
  assert.equal(result.summary.payable, 70);
  assert.equal(result.summary.receivable, 200);
  assert.equal(result.summary.monthlyResult, 320);
  assert.equal(result.summary.projected, 1130);
});

test("transferência e pagamento de fatura não duplicam despesas", () => {
  const result = build(
    [account()],
    [
      transaction({
        transaction_type: "transfer",
        transaction_role: "transfer",
        destination_account_id: "other",
        amount: 600,
      }),
      transaction({ transaction_role: "invoice_payment", amount: 80 }),
    ],
    [purchase({ installment_amount: 80 })],
  );
  assert.equal(result.summary.expenses, 80);
  assert.equal(result.summary.income, 0);
});

test("dashboard agrupa despesas reais por categoria", () => {
  const result = build(
    [account()],
    [
      transaction({
        amount: 120,
        category_id: "food",
        financial_categories: { name: "Alimentação" },
      }),
    ],
    [
      purchase({
        installment_amount: 80,
        category_id: "food",
        financial_categories: { name: "Alimentação" },
      }),
    ],
  );
  assert.deepEqual(result.expenseCategories, [
    { name: "Alimentação", value: 200, percentage: 100 },
  ]);
});

test("conector degradado vira alerta sem apagar os demais dados", () => {
  const connection = {
    id: "connection",
    connector_name: "Banco",
    sync_status: "warning",
    last_successful_sync_at: null,
    provider_status: "degraded",
    data_completeness: "partial",
    loans_sync_status: "pending",
    loans_sync_message: null,
    last_loans_sync_at: null,
  } satisfies BankConnectionSummary;
  const result = build([account()], [], [], [connection]);
  assert.equal(result.degradedConnection?.id, "connection");
  assert.ok(result.attention.some((item) => item.id === "provider"));
  assert.equal(result.summary.available, 1000);
});

test("dashboard vazio produz coleções vazias e não inventa valores", () => {
  const result = build([], []);
  assert.equal(result.summary.available, 0);
  assert.deepEqual(result.commitments, []);
  assert.deepEqual(result.expenseCategories, []);
  assert.deepEqual(result.attention, []);
});

test("mês selecionado e comparação anterior usam exatamente a mesma regra", () => {
  const result = buildFinanceDashboard(
    [account()],
    [
      transaction({
        competence_date: "2026-06-10",
        transaction_type: "income",
        amount: 1_000,
      }),
      transaction({ competence_date: "2026-06-11", amount: 500 }),
      transaction({
        competence_date: "2026-07-10",
        transaction_type: "income",
        amount: 2_000,
      }),
      transaction({ competence_date: "2026-07-11", amount: 1_000 }),
    ],
    [],
    [],
    [],
    new Date("2026-08-15T12:00:00Z"),
    {
      selectedMonth: "2026-07",
      timeZone: "America/Sao_Paulo",
    },
  );
  assert.equal(result.selectedPeriod.key, "2026-07");
  assert.equal(result.summary.monthlyResult, 1_000);
  assert.equal(result.previousSummary.monthlyResult, 500);
  assert.equal(result.resultTrend.difference, 500);
  assert.equal(result.resultTrend.percentage, 100);
});

test("mês anterior zero não produz Infinity", () => {
  const result = build(
    [account()],
    [transaction({ transaction_type: "income", amount: 100 })],
  );
  assert.equal(result.previousSummary.monthlyResult, 0);
  assert.equal(result.resultTrend.percentage, null);
  assert.equal(result.resultTrend.difference, 100);
});

test("comparação parte de resultado negativo sem inverter a melhora", () => {
  const result = buildFinanceDashboard(
    [account()],
    [
      transaction({ competence_date: "2026-06-10", amount: 1_000 }),
      transaction({
        competence_date: "2026-07-10",
        transaction_type: "income",
        amount: 500,
      }),
    ],
    [],
    [],
    [],
    new Date("2026-07-25T12:00:00Z"),
  );
  assert.equal(result.previousSummary.monthlyResult, -1_000);
  assert.equal(result.summary.monthlyResult, 500);
  assert.equal(result.resultTrend.percentage, 150);
});
