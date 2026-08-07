import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMonthlySnapshot,
  calculateCardConsumption,
  calculateReimbursements,
  calculateMonthlyPerspective,
  buildMonthlyNarrative,
  calculateThirdPartyConsumption,
  getMonthlyCardTransactions,
  getMonthlyPeriod,
  isStatementForMonthlyConsumption,
  isStatementSettled,
  mergeDependentCostsIntoRecurringGroups,
  nextMonthlyReportVersion,
  resolveMonthlyPurchaseResponsibility,
  shouldReuseClosedReport,
  validateMonthlyClosing,
  type MonthlyCardPurchase,
  type MonthlyStatement,
} from "./monthly-financial-report";
import type { FinancialTransaction } from "./types";

const period = getMonthlyPeriod(2026, 7);

test("custo de dependente soma extras vinculados sem duplicar compromissos", () => {
  const result = mergeDependentCostsIntoRecurringGroups([{
    name: "Anna Letícia",
    type: "dependent",
    total: 2330.12,
    items: [
      { name: "Escola Anna", amount: 1331 },
      { name: "Plano de Saúde Anna", amount: 329.13 },
      { name: "WellHub Anna", amount: 319.99 },
      { name: "Mesada", amount: 350 },
    ],
  }], [{
    name: "Anna Letícia",
    isDependent: true,
    actualSpentCents: 55000,
    projectedCommitmentsCents: 198012,
  }]);
  assert.equal(result[0].total, 2530.12);
  assert.deepEqual(result[0].items.at(-1), {
    name: "Extras e outras despesas",
    amount: 200,
  });
});
const purchase = (overrides: Partial<MonthlyCardPurchase> = {}) => ({
  id: "purchase-1", card_id: "card-1", invoice_id: null, description: "Compra",
  total_amount: 100, installment_amount: 100, purchase_date: "2026-07-15",
  competence_date: "2026-07-15", installment_number: 1, installment_count: 1,
  source: "pluggy", source_type: "card", financial_origin: "credit_card",
  transaction_role: "consumption", status: "realized", review_status: "reviewed",
  invoice_reference: null, bill_forecast_date: null, provider_category: null,
  merchant: null, visibility: "workspace", category_id: null, workspace_id: "workspace-1",
  responsibility_type: "own_expense", responsibility_confirmed: true,
  personal_share_amount: 100, third_party_share_amount: 0,
  ...overrides,
}) as MonthlyCardPurchase;
const statement = (overrides: Partial<MonthlyStatement> = {}) => ({
  id: "invoice-1", card_id: "card-1", card_name: "Santander",
  official_total_amount: 100, calculated_total_amount: 100,
  reconciliation_difference: 0, reconciliation_status: "matched",
  official_amount_confirmed: true, closing_date: "2026-08-03", due_date: "2026-08-10",
  expected_statement_amount: 100, current_open_amount: 100,
  detected_payment_amount: 100, confirmed_payment_amount: 100,
  payment_difference: 0, payment_confirmation_status: "paid",
  payment_confirmation_source: "bank_transaction",
  payment_confirmed_at: "2026-07-15T12:00:00Z", statement_status: "paid",
  personal_share_amount: 100, third_party_share_amount: 0,
  payments: [{ id: "statement-payment-1", bankTransactionId: "bank-1",
    allocatedAmount: 100, paymentDate: "2026-07-15",
    paymentSource: "bank_transaction", isManual: false, isThirdParty: false }],
  ...overrides,
}) as MonthlyStatement;
const bank = (overrides: Partial<FinancialTransaction> = {}) => ({
  id: "bank-1", description: "Movimento", amount: 100, transaction_type: "expense",
  transaction_role: "consumption", source_type: "bank", financial_origin: "bank_account",
  status: "realized", competence_date: "2026-07-15", due_date: null, realized_at: "2026-07-15T12:00:00Z",
  source: "pluggy", visibility: "workspace", account_id: "account-1", destination_account_id: null,
  category_id: null, workspace_id: "workspace-1", review_status: "reviewed",
  ...overrides,
}) as FinancialTransaction;

test("1. compra de julho processada em agosto pertence a julho", () => {
  const row = purchase({ purchase_date: "2026-07-31", competence_date: "2026-07-31", posting_date: "2026-08-02" });
  assert.deepEqual(getMonthlyCardTransactions([row], period).map((item) => item.id), [row.id]);
});

test("2. compra de agosto pode estar na fatura, mas não no consumo de julho", () => {
  const august = purchase({ id: "august", purchase_date: "2026-08-02", competence_date: "2026-08-02" });
  assert.equal(getMonthlyCardTransactions([august], period).length, 0);
  assert.equal(statement({ official_total_amount: 200 }).official_total_amount, 200);
});

test("3. compra de 2 de julho entra no consumo mesmo em fatura anterior", () => {
  assert.equal(getMonthlyCardTransactions([purchase({ purchase_date: "2026-07-02", competence_date: "2026-07-02" })], period).length, 1);
});

test("4. pagamento de fatura não duplica consumo nem vira renda", () => {
  const snapshot = buildMonthlySnapshot({ period, transactions: [bank({ transaction_role: "invoice_payment", financial_role: "cash_flow_only" })], purchases: [purchase()], statements: [statement()], allocations: [], accounts: [{ id: "account-1", name: "Conta", openingBalance: 1000, closingBalance: 900 }], status: "review" });
  assert.equal(snapshot.totals.totalIncome, 0);
  assert.equal(snapshot.totals.totalBankOutflows, 100);
  assert.equal(snapshot.totals.cashResult, -100);
  assert.equal(snapshot.totals.personalConsumption, 100);
  assert.equal(snapshot.totals.closingBalance, 900);
});

test("5. cartão adicional compõe fatura e gera parte de terceiro", () => {
  const thirdParty = purchase({ responsibility_type: "third_party_expense", personal_share_amount: 0, third_party_share_amount: 100 });
  assert.equal(calculateCardConsumption([thirdParty]), 100);
  assert.equal(calculateThirdPartyConsumption([thirdParty]), 100);
});

test("6. Pix de reembolso reduz pendência e entra no caixa sem virar novo consumo", () => {
  const totals = calculateReimbursements([{ person_id: "p", allocated_amount: 100, reimbursable_amount: 100, reimbursed_amount: 60, pending_reimbursement_amount: 40 }]);
  assert.deepEqual(totals, { received: 60, pending: 40 });
  const snapshot = buildMonthlySnapshot({ period, transactions: [bank({ transaction_type: "income", transaction_role: "refund", financial_role: "correction" })], purchases: [], statements: [], allocations: [], accounts: [{ id: "account-1", name: "Conta", openingBalance: 0, closingBalance: 100 }], status: "review" });
  assert.equal(snapshot.totals.totalIncome, 100);
});

test("7. reembolso pendente é aviso e não bloqueia fechamento", () => {
  const result = validateMonthlyClosing({ period, now: new Date("2026-08-05T12:00:00Z"), status: "review", statements: [statement()], purchases: [purchase()], allocations: [{ person_id: "p", allocated_amount: 100, reimbursable_amount: 100, reimbursed_amount: 0, pending_reimbursement_amount: 100 }] });
  assert.equal(result.canClose, true);
  assert.equal(result.issues.find((item) => item.type === "pending_reimbursement")?.severity, "info");
});

test("8. diferença do pagamento bloqueia até resolução consciente", () => {
  const result = validateMonthlyClosing({ period, now: new Date("2026-08-05T12:00:00Z"), status: "review", statements: [statement({ payment_confirmation_status: "payment_mismatch", payment_difference: 20 })], purchases: [purchase()] });
  assert.equal(result.canClose, false);
  assert.equal(result.blockers[0]?.type, "statement_payment_review");
});

test("9. compra sem vínculo explícito pertence ao titular e não pede confirmação", () => {
  const resolved = resolveMonthlyPurchaseResponsibility(purchase({ responsibility_type: "uncertain", responsibility_confirmed: false }));
  assert.equal(resolved.responsibility_type, "own_expense");
  assert.equal(resolved.responsibility_confirmed, true);
  assert.equal(resolved.personal_share_amount, 100);
  const result = validateMonthlyClosing({ period, now: new Date("2026-08-05T12:00:00Z"), status: "review", statements: [statement()], purchases: [resolved] });
  assert.equal(result.blockers.some((item) => item.type === "unassigned_card_purchase"), false);
});

test("9.1 compra herda a pessoa responsável definida no instrumento do cartão", () => {
  const resolved = resolveMonthlyPurchaseResponsibility(purchase({
    responsibility_type: "uncertain",
    responsibility_confirmed: false,
    credit_card_instruments: {
      display_name: "Cartão da Jéssica",
      last_four_digits: "0613",
      card_kind: "additional",
      payment_responsible_person_id: "person-jessica",
    },
  }));
  assert.equal(resolved.financial_responsible_id, "person-jessica");
  assert.equal(resolved.responsibility_type, "third_party_expense");
  assert.equal(resolved.personal_share_amount, 0);
  assert.equal(resolved.third_party_share_amount, 100);
  assert.equal(calculateThirdPartyConsumption([resolved]), 100);
});

test("9.2 análise de consumo preserva a referência do ciclo sem definir o mês de caixa", () => {
  const juneConsumptionPaidInJuly = statement({
    id: "june-invoice",
    reference_month: "2026-07-01",
    closing_date: "2026-07-03",
    due_date: "2026-07-10",
  });
  const julyConsumptionPaidInAugust = statement({
    id: "july-invoice",
    reference_month: "2026-08-01",
    closing_date: "2026-08-03",
    due_date: "2026-08-10",
  });
  assert.equal(isStatementForMonthlyConsumption(juneConsumptionPaidInJuly, period), false);
  assert.equal(isStatementForMonthlyConsumption(julyConsumptionPaidInAugust, period), true);
});

test("10. reabertura preserva versão anterior e próxima conclusão usa versão 2", () => {
  const versions = [{ version: 1, status: "superseded" }];
  assert.equal(nextMonthlyReportVersion(versions), 2);
  assert.equal(versions[0].version, 1);
});

test("11. nova tentativa de PDF mantém a mesma versão", () => {
  const report = { version: 3, status: "generation_failed" };
  const retry = { ...report, status: "final" };
  assert.equal(retry.version, report.version);
});

test("12. fechamento repetido com o mesmo hash reutiliza o relatório", () => {
  assert.equal(shouldReuseClosedReport({ monthStatus: "closed", currentSnapshotHash: "abc", requestedSnapshotHash: "abc" }), true);
  assert.equal(nextMonthlyReportVersion([{ version: 1 }]), 2);
});

test("13. saldos do período reconciliam caixa mesmo com movimentos posteriores", () => {
  const snapshot = buildMonthlySnapshot({
    period,
    transactions: [bank({
      transaction_type: "income",
      transaction_role: "cash_flow",
      amount: 100,
    })],
    subsequentTransactions: [bank({
      id: "august-income",
      transaction_type: "income",
      transaction_role: "cash_flow",
      amount: 50,
      competence_date: "2026-08-01",
      realized_at: "2026-08-01T12:00:00Z",
    })],
    purchases: [],
    statements: [],
    allocations: [],
    accounts: [{ id: "account-1", name: "Conta", openingBalance: 0, closingBalance: 1_000 }],
    status: "review",
  });
  assert.equal(snapshot.totals.closingBalance, 950);
  assert.equal(snapshot.totals.openingBalance, 850);
  assert.equal(
    snapshot.totals.openingBalance + snapshot.totals.cashResult,
    snapshot.totals.closingBalance,
  );
});

test("14. fatura prevista permanece separada do consumo por competência", () => {
  const snapshot = buildMonthlySnapshot({
    period,
    transactions: [],
    purchases: [purchase({ amount_brl: 300 })],
    statements: [],
    allocations: [],
    accounts: [],
    forecastCardInvoice: 180,
    status: "open",
  });
  assert.equal(snapshot.totals.totalCardConsumption, 300);
  assert.equal(snapshot.totals.forecastCardInvoice, 180);
});

test("15. mediana mensal usa os últimos seis meses concluídos e não transações individuais", () => {
  const perspective = calculateMonthlyPerspective({ current: 1800, history: [1000, 1200, 1400, 1600, 2000, 2200, 9999], subject: "income" });
  assert.equal(perspective.monthsUsed, 6);
  assert.equal(perspective.reference, 1800);
  assert.equal(perspective.percentageDifference, 0);
});

test("16. primeiro mês não inventa mediana ou percentual", () => {
  const perspective = calculateMonthlyPerspective({ current: 1500, history: [], subject: "card" });
  assert.equal(perspective.reference, null);
  assert.equal(perspective.percentageDifference, null);
  assert.match(perspective.message, /históricos suficientes/i);
});

test("17. referência zero não produz infinito", () => {
  const perspective = calculateMonthlyPerspective({ current: 500, history: [0], subject: "income" });
  assert.equal(perspective.absoluteDifference, 500);
  assert.equal(perspective.percentageDifference, null);
});

test("18. narrativa é determinística, curta e sem julgamento", () => {
  const incomePerspective = calculateMonthlyPerspective({ current: 900, history: [1000, 1000, 1000], subject: "income" });
  const narrative = buildMonthlyNarrative({ cashResult: -100, closingBalance: 400, personalConsumption: 700, bankOutflows: 1000, incomePerspective });
  assert.ok(narrative.length <= 3);
  assert.match(narrative.join(" "), /saiu/);
  assert.doesNotMatch(narrative.join(" "), /gastou demais|situação está ruim|administrou mal/i);
});

test("19. renda real exclui resgate mesmo quando ele entra no caixa", () => {
  const snapshot = buildMonthlySnapshot({
    period,
    transactions: [bank({ transaction_type: "income", transaction_role: "cash_flow", cash_flow_kind: "investment_redemption", financial_role: "investment_principal", description: "RESGATE CDB/RDB", amount: 500 })],
    purchases: [], statements: [], allocations: [],
    accounts: [{ id: "account-1", name: "Conta", openingBalance: 0, closingBalance: 500 }],
    status: "review",
  });
  assert.equal(snapshot.totals.totalBankInflows, 500);
  assert.equal(snapshot.totals.totalRealIncome, 0);
});

test("20. salário confirmado entra na renda real", () => {
  const snapshot = buildMonthlySnapshot({
    period,
    transactions: [bank({ transaction_type: "income", transaction_role: "cash_flow", financial_role: "revenue", description: "SALÁRIO", amount: 1000 })],
    purchases: [], statements: [], allocations: [],
    accounts: [{ id: "account-1", name: "Conta", openingBalance: 0, closingBalance: 1000 }],
    status: "review",
  });
  assert.equal(snapshot.totals.totalRealIncome, 1000);
});

test("21. pagamento de fatura é excluído do consumo mesmo com papel legado de despesa", () => {
  const snapshot = buildMonthlySnapshot({
    period,
    transactions: [bank({ transaction_role: "invoice_payment", financial_role: "expense", amount: 700 })],
    purchases: [], statements: [], allocations: [],
    accounts: [{ id: "account-1", name: "Conta", openingBalance: 1000, closingBalance: 300 }],
    status: "review",
  });
  assert.equal(snapshot.totals.totalBankOutflows, 700);
  assert.equal(snapshot.totals.personalConsumption, 0);
});

test("22. snapshot preserva casa, dependentes, terceiros, parcelas e projeção sem duplicar o total", () => {
  const snapshot = buildMonthlySnapshot({
    period, transactions: [], purchases: [], statements: [], accounts: [], status: "review",
    allocations: [{ person_id: "person-1", person_name: "Anna", source_card_movement_id: "purchase-1", allocated_amount: 300, reimbursable_amount: 300, reimbursed_amount: 100, pending_reimbursement_amount: 200 }],
    recurringGroups: [{ name: "Casa", type: "household", total: 500, items: [{ name: "Internet", amount: 100 }] }, { name: "Anna", type: "dependent", total: 300, items: [{ name: "Escola", amount: 300 }] }],
    installments: [{ id: "plan-1", description: "Notebook", current: 7, total: 12, amount: 200, paid: 1200, remaining: 1000, endsAt: "2026-12-01" }],
    futureCommitmentMonths: [{ month: "2026-08", amount: 1400 }],
    futureInstallments: [{ month: "2026-08", amount: 200 }],
  });
  assert.equal(snapshot.householdCost?.total, 500);
  assert.equal(snapshot.dependentsCost?.total, 300);
  assert.equal(snapshot.thirdPartySummary?.[0].pending, 200);
  assert.equal(snapshot.installments?.remaining, 1000);
  assert.deepEqual(snapshot.projection?.[0], { month: "2026-08", total: 1400, installments: 200, recurring: 800, other: 600, card: 0 });
});

test("23. ausência de PDF ou fatura paga no mês não bloqueia o fechamento", () => {
  const validation = validateMonthlyClosing({ period, status: "review", statements: [], purchases: [], expectedStatementCount: 1, now: new Date("2026-08-04T12:00:00Z") });
  assert.equal(validation.canClose, true);
  assert.equal(validation.blockers.length, 0);
});

test("24. fatura oficial paga antecipadamente permanece visível sem comprometer agosto outra vez", () => {
  const augustStatement = statement({
    due_date: "2026-08-10",
    official_total_amount: 11517.22,
    expected_statement_amount: 11517.22,
    current_open_amount: 11517.22,
    confirmed_payment_amount: 11517.22,
    payment_confirmation_status: "paid",
  });
  const snapshot = buildMonthlySnapshot({
    period, transactions: [], purchases: [], statements: [], openStatements: [augustStatement],
    allocations: [], accounts: [], status: "review",
    futureCommitmentMonths: [{ month: "2026-08", amount: 0 }],
  });
  assert.equal(isStatementSettled(augustStatement), true);
  assert.equal(snapshot.openStatements?.[0]?.id, augustStatement.id);
  assert.equal(snapshot.projection?.[0]?.card, 0);
});
