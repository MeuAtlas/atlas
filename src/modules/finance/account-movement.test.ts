import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateBankAccountMonthlyMovement,
  classifyBankAccountMovement,
  isTransactionalBankAccount,
} from "./account-movement";
import { getFinanceMonthPeriod } from "./monthly-result";
import type {
  BankConnectionSummary,
  FinancialAccount,
  FinancialTransaction,
} from "./types";

const account: FinancialAccount = {
  id: "santander",
  bank_connection_id: "connection",
  name: "Santander",
  institution_name: "Santander",
  account_type: "checking",
  current_balance: 8_465.76,
  opening_balance: 0,
  source: "pluggy",
  status: "active",
  visibility: "private",
  workspace_id: null,
  last_sync_at: "2026-07-31T18:00:00Z",
};
const july = getFinanceMonthPeriod({
  year: 2026,
  month: 7,
  timeZone: "America/Sao_Paulo",
});
let sequence = 0;
function tx(
  overrides: Partial<FinancialTransaction> = {},
): FinancialTransaction {
  sequence++;
  return {
    id: `tx-${sequence}`,
    description: "Movimentação",
    amount: 100,
    original_amount: 100,
    transaction_type: "income",
    transaction_role: "cash_flow",
    source_type: "bank",
    financial_origin: "bank_account",
    status: "realized",
    competence_date: "2026-07-10",
    due_date: null,
    realized_at: "2026-07-10T12:00:00Z",
    source: "pluggy",
    visibility: "private",
    account_id: account.id,
    destination_account_id: null,
    category_id: null,
    workspace_id: null,
    review_status: "reviewed",
    ...overrides,
  };
}
const calculate = (rows: FinancialTransaction[]) =>
  calculateBankAccountMonthlyMovement({
    account,
    transactions: rows,
    period: july,
  });

test("calcula entradas, saídas, resultado positivo, negativo e zero", () => {
  const positive = calculate([
    tx({ amount: 500, original_amount: 500 }),
    tx({
      amount: 200,
      original_amount: -200,
      transaction_type: "expense",
    }),
  ]);
  assert.equal(positive.totalInflow, 500);
  assert.equal(positive.totalOutflow, 200);
  assert.equal(positive.netMovement, 300);

  assert.equal(
    calculate([
      tx({ amount: 100, original_amount: 100 }),
      tx({ amount: 400, original_amount: -400 }),
    ]).netMovement,
    -300,
  );
  assert.equal(
    calculate([
      tx({ amount: 250, original_amount: 250 }),
      tx({ amount: 250, original_amount: -250 }),
    ]).netMovement,
    0,
  );
});

test("Pix recebido e enviado respeitam o sinal oficial do provedor", () => {
  assert.equal(
    classifyBankAccountMovement(
      tx({ description: "Pix recebido", original_amount: 90 }),
      account.id,
    ),
    "inflow",
  );
  assert.equal(
    classifyBankAccountMovement(
      tx({
        description: "Pix enviado",
        original_amount: -70,
        transaction_type: "expense",
      }),
      account.id,
    ),
    "outflow",
  );
});

test("transferência própria entra nos dois lados da conta individual", () => {
  const incoming = tx({
    account_id: "nubank",
    destination_account_id: account.id,
    transaction_type: "transfer",
    transaction_role: "transfer",
    financial_origin: "transfer",
    original_amount: null,
  });
  const outgoing = tx({
    account_id: account.id,
    destination_account_id: "nubank",
    transaction_type: "transfer",
    transaction_role: "transfer",
    financial_origin: "transfer",
    original_amount: null,
  });
  assert.equal(classifyBankAccountMovement(incoming, account.id), "inflow");
  assert.equal(classifyBankAccountMovement(outgoing, account.id), "outflow");
});

test("empréstimo e resgate entram; aplicação e fatura paga saem", () => {
  const result = calculate([
    tx({ amount: 5_000, cash_flow_kind: "loan_proceeds" }),
    tx({ amount: 2_000, cash_flow_kind: "investment_redemption" }),
    tx({
      amount: 1_500,
      original_amount: -1_500,
      cash_flow_kind: "investment_contribution",
      transaction_type: "expense",
      transaction_role: "adjustment",
      financial_origin: "adjustment",
    }),
    tx({
      amount: 900,
      original_amount: -900,
      transaction_type: "transfer",
      transaction_role: "invoice_payment",
      financial_origin: "invoice",
      review_status: "pending",
    }),
  ]);
  assert.equal(result.totalInflow, 7_000);
  assert.equal(result.totalOutflow, 2_400);
});

test("compra de cartão e consignado em folha nunca entram", () => {
  const result = calculate([
    tx({
      source_type: "card",
      financial_origin: "credit_card",
      transaction_role: "consumption",
      credit_card_id: "card",
      original_amount: -100,
    }),
    tx({
      source_type: "payroll",
      payment_source: "payroll",
      account_id: null,
      loan_id: "loan",
      original_amount: -200,
    }),
  ]);
  assert.equal(result.totalInflow, 0);
  assert.equal(result.totalOutflow, 0);
});

test("cancelados, duplicados e pendentes não contaminam o resultado", () => {
  const first = tx({
    external_id: "same",
    amount: 300,
    original_amount: 300,
  });
  const result = calculate([
    first,
    tx({
      external_id: "same",
      amount: 300,
      original_amount: 300,
    }),
    tx({ status: "cancelled", amount: 900 }),
    tx({ status: "pending", amount: 700 }),
  ]);
  assert.equal(result.totalInflow, 300);
  assert.equal(result.inflowCount, 1);
  assert.equal(result.pendingCount, 1);
  assert.match(result.warnings.join(" "), /pendente/);
});

test("reimportação posted substitui pending com o mesmo identificador", () => {
  const result = calculate([
    tx({ external_id: "provider", status: "pending", amount: 200 }),
    tx({ external_id: "provider", status: "posted", amount: 200 }),
  ]);
  assert.equal(result.totalInflow, 200);
  assert.equal(result.pendingCount, 0);
});

test("conta manual usa a mesma regra sem exigir conexão", () => {
  const manual = calculateBankAccountMonthlyMovement({
    account: { ...account, source: "manual", bank_connection_id: null },
    transactions: [
      tx({
        source: "manual",
        original_amount: null,
        transaction_type: "expense",
      }),
    ],
    period: july,
  });
  assert.equal(manual.totalOutflow, 100);
  assert.equal(manual.dataCompleteness, "complete");
});

test("mês vazio mantém todos os dias e totais zerados", () => {
  const result = calculate([]);
  assert.equal(result.dailySeries.length, 31);
  assert.equal(result.totalInflow, 0);
  assert.equal(result.totalOutflow, 0);
  assert.ok(
    result.dailySeries.every(
      (point) => point.cumulativeInflow === 0 && point.cumulativeOutflow === 0,
    ),
  );
});

test("série diária inclui dias vazios e acumula múltiplos eventos", () => {
  const result = calculate([
    tx({ amount: 100, original_amount: 100, realized_at: "2026-07-01T15:00:00Z" }),
    tx({ amount: 50, original_amount: 50, realized_at: "2026-07-01T18:00:00Z" }),
    tx({
      amount: 40,
      original_amount: -40,
      transaction_type: "expense",
      realized_at: "2026-07-03T12:00:00Z",
    }),
  ]);
  assert.deepEqual(result.dailySeries[0], {
    date: "2026-07-01",
    label: "01",
    dailyInflow: 150,
    dailyOutflow: 0,
    cumulativeInflow: 150,
    cumulativeOutflow: 0,
  });
  assert.equal(result.dailySeries[1].dailyInflow, 0);
  assert.equal(result.dailySeries[2].cumulativeOutflow, 40);
  assert.equal(result.dailySeries.at(-1)?.cumulativeInflow, 150);
});

test("gera 28, 29, 30 e 31 dias e atravessa dezembro", () => {
  const lengths = [
    [2025, 2, 28],
    [2024, 2, 29],
    [2026, 4, 30],
    [2026, 7, 31],
    [2026, 12, 31],
  ] as const;
  for (const [year, month, days] of lengths) {
    const period = getFinanceMonthPeriod({ year, month });
    const result = calculateBankAccountMonthlyMovement({
      account,
      transactions: [],
      period,
    });
    assert.equal(result.dailySeries.length, days);
    if (month === 12) assert.equal(result.monthEnd, "2027-01-01");
  }
});

test("timezone brasileiro mantém lançamento UTC no mês bancário correto", () => {
  const result = calculate([
    tx({
      transaction_date: null,
      realized_at: "2026-08-01T01:30:00Z",
      competence_date: "2026-08-01",
    }),
  ]);
  assert.equal(result.totalInflow, 100);
  assert.equal(result.dailySeries.at(-1)?.dailyInflow, 100);
});

test("troca de conta considera exclusivamente a conta selecionada", () => {
  const result = calculate([
    tx({ account_id: "nubank", amount: 900 }),
    tx({ account_id: account.id, amount: 100 }),
  ]);
  assert.equal(result.totalInflow, 100);
});

test("Pluggy parcial preserva valores e expõe aviso e última sincronização", () => {
  const connection = {
    id: "connection",
    connector_name: "Santander",
    sync_status: "partial",
    last_successful_sync_at: "2026-07-30T12:00:00Z",
    data_completeness: "partial",
    loans_sync_status: "complete",
    loans_sync_message: null,
    last_loans_sync_at: null,
  } satisfies BankConnectionSummary;
  const result = calculateBankAccountMonthlyMovement({
    account: { ...account, last_sync_at: null },
    transactions: [tx({ amount: 400 })],
    period: july,
    connection,
  });
  assert.equal(result.totalInflow, 400);
  assert.equal(result.dataCompleteness, "partial");
  assert.equal(result.lastSyncAt, connection.last_successful_sync_at);
  assert.match(result.warnings.join(" "), /Dados parciais/);
});

test("somente contas bancárias transacionais ativas são elegíveis", () => {
  assert.equal(isTransactionalBankAccount(account), true);
  assert.equal(
    isTransactionalBankAccount({ ...account, account_type: "investment" }),
    false,
  );
  assert.equal(
    isTransactionalBankAccount({ ...account, status: "archived" }),
    false,
  );
  assert.equal(
    isTransactionalBankAccount({ ...account, account_type: "cash" }),
    false,
  );
});

test("cenário de aceitação Santander soma caixa sem misturar cartão ou folha", () => {
  const rows = [
    tx({ amount: 20_000, original_amount: 20_000, description: "Salário" }),
    tx({ amount: 2_000, original_amount: 2_000, description: "Pix recebido" }),
    tx({
      amount: 1_000,
      original_amount: null,
      account_id: "nubank",
      destination_account_id: account.id,
      transaction_type: "transfer",
      transaction_role: "transfer",
      financial_origin: "transfer",
    }),
    tx({ amount: 5_000, original_amount: 5_000, cash_flow_kind: "loan_proceeds" }),
    tx({ amount: 2_000, original_amount: 2_000, cash_flow_kind: "investment_redemption" }),
    tx({ amount: 4_000, original_amount: -4_000, transaction_type: "expense" }),
    tx({ amount: 3_000, original_amount: -3_000, transaction_type: "expense" }),
    tx({
      amount: 5_000,
      original_amount: -5_000,
      transaction_type: "transfer",
      transaction_role: "invoice_payment",
      financial_origin: "invoice",
    }),
    tx({
      amount: 2_000,
      original_amount: -2_000,
      transaction_type: "expense",
      transaction_role: "adjustment",
      financial_origin: "adjustment",
      cash_flow_kind: "investment_contribution",
    }),
    tx({
      amount: 1_000,
      original_amount: null,
      destination_account_id: "nubank",
      transaction_type: "transfer",
      transaction_role: "transfer",
      financial_origin: "transfer",
    }),
    tx({
      amount: 9_000,
      original_amount: -9_000,
      source_type: "card",
      financial_origin: "credit_card",
      transaction_role: "consumption",
    }),
    tx({
      amount: 800,
      original_amount: -800,
      account_id: null,
      source_type: "payroll",
      payment_source: "payroll",
      loan_id: "loan",
    }),
  ];
  const result = calculate(rows);
  assert.equal(result.accountName, "Santander");
  assert.equal(result.totalInflow, 30_000);
  assert.equal(result.totalOutflow, 15_000);
  assert.equal(result.netMovement, 15_000);
  assert.equal(result.inflowItems.length, 5);
  assert.equal(result.outflowItems.length, 5);
  assert.equal(
    result.inflowItems.reduce((total, item) => total + item.amount, 0),
    result.totalInflow,
  );
  assert.equal(
    result.outflowItems.reduce((total, item) => total + item.amount, 0),
    result.totalOutflow,
  );
});

test("retorno central inclui comparação do mês anterior sem contaminar julho", () => {
  const result = calculateBankAccountMonthlyMovement({
    account,
    transactions: [tx({ amount: 500, original_amount: 500 })],
    previousTransactions: [
      tx({
        amount: 300,
        original_amount: 300,
        competence_date: "2026-06-10",
        realized_at: "2026-06-10T12:00:00Z",
      }),
      tx({
        amount: 125,
        original_amount: -125,
        transaction_type: "expense",
        competence_date: "2026-06-12",
        realized_at: "2026-06-12T12:00:00Z",
      }),
    ],
    period: july,
  });
  assert.equal(result.totalInflow, 500);
  assert.equal(result.previousMonthInflow, 300);
  assert.equal(result.previousMonthOutflow, 125);
});
