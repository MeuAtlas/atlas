import assert from "node:assert/strict";
import test from "node:test";

import type { FinancialMonthRecord } from "./monthly-financial-report-query";
import type { IncomeExpenseListItem, IncomeExpensePageData } from "./income-expenses-query";
import {
  buildMonthlySnapshot,
  getMonthlyPeriod,
  type MonthlyCardPurchase,
  type MonthlyStatement,
} from "./monthly-financial-report";
import {
  buildMonthlyReportReviewViewModel,
  deriveMonthlyReportStatus,
} from "./monthly-report-review";
import type { FinancialTransaction } from "./types";

const period = getMonthlyPeriod(2026, 7);
const bank = (overrides: Partial<FinancialTransaction> = {}) => ({
  id: "bank-1", description: "Compra sem categoria", amount: 100,
  original_amount: -100, transaction_type: "expense", transaction_role: "consumption",
  source_type: "bank", financial_origin: "bank_account", status: "realized",
  competence_date: "2026-07-15", due_date: null,
  realized_at: "2026-07-15T12:00:00Z", source: "pluggy",
  visibility: "workspace", account_id: "account-1", destination_account_id: null,
  category_id: null, workspace_id: "workspace-1", review_status: "reviewed",
  bank_direction: "outflow", financial_categories: null,
  ...overrides,
}) as FinancialTransaction;
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
  id: "invoice-1", card_id: "card-1", card_name: "Santander Unlimited",
  official_total_amount: 11_517.22, calculated_total_amount: 11_517.22,
  reconciliation_difference: 0, reconciliation_status: "matched",
  official_amount_confirmed: true, closing_date: "2026-07-03", due_date: "2026-07-10",
  expected_statement_amount: 11_517.22, current_open_amount: 11_517.22,
  detected_payment_amount: 0, confirmed_payment_amount: 0,
  payment_difference: -11_517.22, payment_confirmation_status: "estimated",
  payment_confirmation_source: null, payment_confirmed_at: null,
  statement_status: "estimated", personal_share_amount: 11_517.22,
  third_party_share_amount: 0, payments: [],
  ...overrides,
}) as MonthlyStatement;
const month = (status = "awaiting_consolidation") => ({
  id: "month-1", workspace_id: "workspace-1", reference_year: 2026,
  reference_month: 7, status, current_report_id: null,
}) as FinancialMonthRecord;

const registeredItem = (overrides: Partial<IncomeExpenseListItem> = {}) => ({
  id: "commitment-1", occurrenceId: "occurrence-1", categoryId: null,
  accountId: null, cardId: null, personId: null, title: "Compromisso",
  description: null, direction: "expense", recurrenceFrequency: "monthly",
  expectedDateDay: null, estimationMethod: "fixed", aggregationMode: "single_occurrence",
  contextType: "personal", status: "active", expectedAmountCents: 0,
  realizedAmountCents: 0, differenceCents: 0, occurrenceStatus: "projected",
  competenceMonth: "2026-07-01", expectedDate: null, paymentDate: null,
  paymentMethod: "bank_debit", paymentSourceName: null, settlementSource: null,
  linkedInvoiceId: null, linkedTransactionId: null, creditsCount: 0,
  historicalMedianCents: null, historicalAverageCents: null, historicalMonthsCount: 0,
  incomeBasis: null, cashFlowEffect: "decrease", planningEffect: "decrease",
  analyticsEffect: "expense", paymentChannel: "bank", isPayrollDeduction: false,
  categoryName: null, personNames: [],
  ...overrides,
}) as IncomeExpenseListItem;

const registeredFlows = (items: IncomeExpenseListItem[]) => ({
  incomes: items.filter(item => item.direction === "income"),
  expenses: items.filter(item => item.direction === "expense"),
}) as Pick<IncomeExpensePageData, "incomes" | "expenses">;

function snapshot(input: {
  statements?: MonthlyStatement[];
  openStatements?: MonthlyStatement[];
  unmatched?: number;
  transactions?: FinancialTransaction[];
  purchases?: MonthlyCardPurchase[];
  firstMonth?: boolean;
}) {
  return buildMonthlySnapshot({
    period,
    transactions: input.transactions ?? [bank()],
    purchases: input.purchases ?? [purchase()],
    statements: input.statements ?? [],
    openStatements: input.openStatements ?? [],
    unmatchedPaymentCount: input.unmatched ?? 0,
    allocations: [],
    accounts: [{ id: "account-1", name: "Banco Santander", openingBalance: 1000, closingBalance: 900 }],
    status: "awaiting_consolidation",
    tracking: {
      startedAt: period.startInstant,
      isFirstFinancialReport: input.firstMonth ?? true,
      reportOrigin: "live_tracked",
    },
    incomeHistoricalReference: { median: input.firstMonth === false ? 2000 : null, months: input.firstMonth === false ? 1 : 0 },
    recurringGroups: [],
  });
}

test("status visual vira review após o fim do mês sem bloqueios", () => {
  assert.equal(deriveMonthlyReportStatus({
    persistedStatus: "awaiting_consolidation",
    periodStart: period.startInstant,
    periodEndExclusive: period.endExclusiveInstant,
    blockerCount: 0,
    now: new Date("2026-08-02T12:00:00Z"),
  }), "review");
});

test("status visual vira needs_attention quando há pagamento sem vínculo", () => {
  assert.equal(deriveMonthlyReportStatus({
    persistedStatus: "awaiting_consolidation",
    periodStart: period.startInstant,
    periodEndExclusive: period.endExclusiveInstant,
    blockerCount: 1,
    now: new Date("2026-08-02T12:00:00Z"),
  }), "needs_attention");
});

test("pagamento candidato fica detectado, não confirmado, e aparece no topo", () => {
  const julyStatement = statement();
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ unmatched: 1 }),
    statements: [], reconciliationStatements: [julyStatement], openStatements: [],
    paymentCandidates: [{ id: "bank-payment", description: "PAGAMENTO CARTAO",
      amount: 11_517.22, paymentDate: "2026-07-04", creditCardId: "card-1", confidence: "high" }],
    purchases: [purchase()], versions: [], now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.header.status, "needs_attention");
  assert.equal(view.blockingIssues[0]?.candidate?.amount, 11_517.22);
  assert.equal(view.paidStatements.length, 0);
  assert.equal(view.detectedStatements[0]?.state, "detected");
});

test("pagamento confirmado aparece como pago e remove o bloqueio", () => {
  const paid = statement({
    confirmed_payment_amount: 11_517.22, detected_payment_amount: 11_517.22,
    payment_difference: 0, payment_confirmation_status: "paid",
    payments: [{ id: "payment-1", bankTransactionId: "bank-payment",
      allocatedAmount: 11_517.22, paymentDate: "2026-07-04",
      paymentSource: "bank_transaction", isManual: false, isThirdParty: false }],
  });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ statements: [paid] }),
    statements: [paid], reconciliationStatements: [], openStatements: [],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.header.status, "review");
  assert.equal(view.blockingIssues.length, 0);
  assert.equal(view.paidStatements[0]?.state, "confirmed");
  assert.equal(view.paidStatements[0]?.confirmed_payment_amount, 11_517.22);
});

test("fatura seguinte aberta informa o futuro sem bloquear julho", () => {
  const august = statement({ id: "august", due_date: "2026-08-10",
    closing_date: "2026-08-03", current_open_amount: 7_082.45,
    personal_share_amount: 5_536.53, expected_statement_amount: 7_082.45 });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ openStatements: [august] }),
    statements: [], reconciliationStatements: [], openStatements: [august],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.blockingIssues.length, 0);
  assert.equal(view.openStatements.length, 1);
});

test("fatura oficial do próximo mês não mantém a parte pessoal como estimativa", () => {
  const august = statement({
    id: "august-official",
    official_amount_confirmed: true,
    official_total_amount: 11_517.22,
    current_open_amount: 10_997.96,
    personal_share_amount: 11_517.22,
    due_date: "2026-08-10",
  });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ openStatements: [august] }),
    statements: [], reconciliationStatements: [], openStatements: [august],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.openStatements[0]?.personal_share_amount, 11_517.22);
});

test("PDF confirmado aparece como anexado no checklist", () => {
  const paid = statement({
    official_amount_confirmed: true,
    pdf_document_id: "document-july",
  });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ statements: [paid] }),
    statements: [paid], reconciliationStatements: [], openStatements: [],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(
    view.finalReview.find(item => item.label === "PDF da fatura")?.value,
    "Anexado",
  );
});

test("folha mensal separa receita, cartão, folha e conta sem repetir pagamento de fatura", () => {
  const income = bank({ id: "income", description: "Salário", amount: 2_000,
    original_amount: 2_000, transaction_type: "income", bank_direction: "inflow" });
  const direct = bank({ id: "direct", description: "Boleto", amount: 300 });
  const invoicePayment = bank({ id: "invoice-payment", description: "PAGAMENTO FATURA",
    amount: 100, transaction_role: "invoice_payment" });
  const payroll = bank({ id: "payroll", description: "Plano de saúde", amount: 150,
    source_type: "payroll", account_id: null, bank_direction: null, recurring_rule_id: "rule-1" });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(),
    snapshot: snapshot({ transactions: [income, direct, invoicePayment, payroll], purchases: [purchase()] }),
    statements: [], reconciliationStatements: [], openStatements: [], paymentCandidates: [],
    purchases: [purchase()], versions: [], now: new Date("2026-08-02T12:00:00Z"),
  });
  const groups = new Map(view.detailGroups.map(group => [group.key, group]));
  assert.equal(groups.get("income")?.total, 2_000);
  assert.equal(groups.get("card")?.total, 100);
  assert.equal(groups.get("payroll")?.total, 150);
  assert.equal(groups.get("account")?.total, 300);
  assert.equal(groups.get("account")?.items.some(item => item.description === "PAGAMENTO FATURA"), false);
});

test("folha prioriza o valor oficial da fatura paga sem somar as compras avulsas", () => {
  const officialStatement = statement({
    official_total_amount: 11_517.22,
    expected_statement_amount: 11_517.22,
    payment_confirmation_status: "paid",
  });
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ purchases: [purchase({ total_amount: 441.75, installment_amount: 441.75 })] }),
    statements: [officialStatement], reconciliationStatements: [], openStatements: [], paymentCandidates: [],
    purchases: [purchase()], versions: [], now: new Date("2026-08-02T12:00:00Z"),
  });
  const card = view.detailGroups.find(group => group.key === "card");
  assert.equal(card?.total, 11_517.22);
  assert.deepEqual(card?.items, [{ description: "Santander Unlimited · fatura oficial", amount: 11_517.22 }]);
});

test("folha usa apenas receitas e despesas cadastradas, não qualquer saída da conta", () => {
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(),
    snapshot: snapshot({ transactions: [bank({ description: "PIX avulso", amount: 9_999 })] }),
    statements: [statement()], reconciliationStatements: [], openStatements: [],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    registeredFlows: registeredFlows([
      registeredItem({ id: "income", title: "Salário", direction: "income", expectedAmountCents: 10_000_00, realizedAmountCents: 9_000_00, cashFlowEffect: "inflow", planningEffect: "increase", analyticsEffect: "income", paymentChannel: "bank" }),
      registeredItem({ id: "income-open", title: "Diárias pendentes", direction: "income", expectedAmountCents: 2_000_00, cashFlowEffect: "inflow", planningEffect: "increase", analyticsEffect: "income", paymentChannel: "bank" }),
      registeredItem({ id: "account", title: "Escola", expectedAmountCents: 1_331_00 }),
      registeredItem({ id: "card", title: "Spotify", expectedAmountCents: 23_90, paymentMethod: "credit_card", paymentChannel: "card", cardId: "card-1" }),
      registeredItem({ id: "payroll", title: "Consignado", expectedAmountCents: 2_233_57, paymentMethod: "payroll", paymentChannel: "payroll", isPayrollDeduction: true, cashFlowEffect: "none" }),
    ]),
    eventualExpenses: [{ description: "Restaurante eventual", amount: 85 }],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  const groups = new Map(view.detailGroups.map(group => [group.key, group]));
  assert.equal(groups.get("income")?.total, 9_000);
  assert.equal(groups.get("income")?.items.some(item => item.description === "Diárias pendentes"), false);
  assert.equal(groups.get("account")?.total, 1_331);
  assert.equal(groups.get("card")?.total, 23.9);
  assert.equal(groups.get("payroll")?.total, 2_233.57);
  assert.equal(groups.get("payroll")?.items[0]?.state, "paid");
  assert.equal(groups.get("eventual")?.total, 85);
  assert.equal(view.identifiedExpenses, 3_673.47);
  assert.equal(groups.get("account")?.items.some(item => item.description === "PIX avulso"), false);
});

test("primeiro mês não usa falsa mediana e categorias pendentes são aviso", () => {
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: snapshot({ firstMonth: true }),
    statements: [], reconciliationStatements: [], openStatements: [],
    paymentCandidates: [], purchases: [purchase()], versions: [],
    now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.income.reference, null);
  assert.equal(view.warnings.some(item => item.id === "categories"), true);
  assert.equal(view.blockingIssues.length, 0);
  assert.equal(view.commitments.householdUnclassified, true);
});

test("compromissos futuros usam fatura e recorrentes sem somar parcelas novamente", () => {
  const base = snapshot({ firstMonth: false });
  base.projection = [{ month: "2026-08", total: 14_000, card: 5_500,
    recurring: 8_500, other: 0, installments: 2_300 }];
  const view = buildMonthlyReportReviewViewModel({
    financialMonth: month(), snapshot: base, statements: [],
    reconciliationStatements: [], openStatements: [], paymentCandidates: [],
    purchases: [purchase()], versions: [], now: new Date("2026-08-02T12:00:00Z"),
  });
  assert.equal(view.future.months[0]?.total, 14_000);
  assert.equal("installments" in view.future.months[0], false);
});
