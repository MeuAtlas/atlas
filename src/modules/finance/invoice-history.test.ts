import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  decodeInvoiceHistoryCursor,
  encodeInvoiceHistoryCursor,
  buildInvoiceHistoryAnalytics,
  filterHistoricalInvoices,
  inferFullInvoicePayment,
  isHistoricalInvoice,
  normalizeHistoricalInvoice,
  resolveHistoricalInvoiceTotal,
  sortHistoricalInvoices,
} from "./invoice-history";
import type {
  CardPurchase,
  CreditCard,
  FinancialTransaction,
  StoredCardInvoice,
} from "./types";

const invoice = (
  overrides: Partial<StoredCardInvoice> = {},
): StoredCardInvoice => ({
  id: "invoice-july",
  card_id: "mastercard",
  reference_month: "2026-07-01",
  cycle_start_date: "2026-06-04",
  cycle_end_date: "2026-07-03",
  closing_date: "2026-07-03",
  due_date: "2026-07-10",
  total_amount: 0,
  paid_amount: 0,
  paid_at: null,
  outstanding_amount: 0,
  purchase_count: 0,
  status: "closed",
  external_id: null,
  provider_invoice_total: null,
  calculated_invoice_total: 200,
  manual_invoice_total: null,
  total_source: "calculated_transactions",
  reconciliation_status: "provider_unavailable",
  provider_updated_at: null,
  ...overrides,
});

const card = (
  id = "mastercard",
  brand = "Mastercard",
): CreditCard => ({
  id,
  name: `${brand} Black`,
  institution_name: "Santander",
  last_four_digits: id === "visa" ? "0613" : "5718",
  brand,
  credit_limit: 20000,
  used_limit: 0,
  current_balance: 0,
  closing_day: 3,
  due_day: 10,
  status: "active",
  visibility: "private",
  linked_account_id: null,
  last_sync_at: null,
});

const purchase = (
  overrides: Partial<CardPurchase> = {},
): CardPurchase => ({
  id: "purchase",
  card_id: "mastercard",
  invoice_id: "invoice-july",
  description: "Mercado",
  total_amount: 200,
  installment_amount: 200,
  purchase_date: "2026-06-20",
  competence_date: "2026-06-20",
  installment_number: 1,
  installment_count: 1,
  source: "pluggy",
  source_type: "card",
  financial_origin: "credit_card",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: "2026-07",
  bill_forecast_date: null,
  provider_category: "Alimentação",
  merchant: "Mercado",
  visibility: "private",
  category_id: null,
  ...overrides,
});

const payment = (
  overrides: Partial<FinancialTransaction> = {},
): FinancialTransaction =>
  ({
    id: "payment",
    invoice_id: null,
    credit_card_id: null,
    transaction_role: "invoice_payment",
    transaction_type: "expense",
    source_type: "bank",
    financial_origin: "bank_account",
    amount: 11517.22,
    description: "PAGAMENTO CARTAO CREDITO BCE 04/07 12:47 CARTAO MASTER",
    status: "realized",
    bank_direction: "outflow",
    realized_at: "2026-07-04T12:47:00-03:00",
    competence_date: "2026-07-04",
    due_date: null,
    source: "pluggy",
    visibility: "private",
    account_id: "santander-account",
    destination_account_id: null,
    category_id: null,
    workspace_id: null,
    financial_accounts: {
      name: "Conta Santander",
      institution_name: "Banco Santander",
    },
    ...overrides,
  }) as FinancialTransaction;

test("somente ciclos já fechados entram no histórico", () => {
  assert.equal(isHistoricalInvoice(invoice(), "2026-07-25"), true);
  assert.equal(isHistoricalInvoice(invoice({ status: "paid" }), "2026-07-25"), true);
  assert.equal(isHistoricalInvoice(invoice({ status: "overdue" }), "2026-07-25"), true);
  assert.equal(isHistoricalInvoice(invoice({ status: "open" }), "2026-07-25"), false);
  assert.equal(
    isHistoricalInvoice(
      invoice({ status: "due", closing_date: "2026-08-03" }),
      "2026-07-25",
    ),
    false,
  );
});

test("prioriza total oficial, manual, calculado e nunca transforma ausência em zero", () => {
  assert.deepEqual(
    resolveHistoricalInvoiceTotal(
      invoice({
        provider_invoice_total: 400,
        manual_invoice_total: 300,
        calculated_invoice_total: 200,
      }),
    ),
    { total: 400, source: "provider_bill" },
  );
  assert.equal(
    resolveHistoricalInvoiceTotal(
      invoice({ calculated_invoice_total: null, manual_invoice_total: 300 }),
    ).source,
    "manual_bank_confirmation",
  );
  assert.deepEqual(
    resolveHistoricalInvoiceTotal(
      invoice({
        calculated_invoice_total: null,
        manual_invoice_total: null,
      }),
    ),
    { total: null, source: "unavailable" },
  );
});

test("pagamento integral confirma o total sem sobrescrever os lançamentos identificados", () => {
  const normalized = normalizeHistoricalInvoice({
    invoice: invoice({
      cycle_start_date: "2026-06-03",
      cycle_end_date: "2026-07-03",
      calculated_invoice_total: 9953.1,
      paid_amount: 11517.22,
      paid_at: null,
      purchase_count: 95,
      status: "paid",
    }),
    card: card(),
    purchases: [],
    payments: [payment()],
  });

  assert.equal(normalized.total, 11517.22);
  assert.equal(normalized.totalSource, "confirmed_by_full_payment");
  assert.equal(normalized.calculatedTotal, 9953.1);
  assert.equal(normalized.paidAmount, 11517.22);
  assert.equal(normalized.reconciliationDifference, 1564.12);
  assert.equal(normalized.reconciliationStatus, "incomplete");
  assert.equal(normalized.purchaseCount, 95);
  assert.equal(normalized.payingAccountName, "Banco Santander");
  assert.equal(normalized.paidAt, "2026-07-04T12:47:00-03:00");
});

test("pagamento bancário Santander ainda não classificado também é reconhecido", () => {
  const normalized = normalizeHistoricalInvoice({
    invoice: invoice({
      calculated_invoice_total: 9953.1,
      paid_amount: 11517.22,
      status: "paid",
    }),
    card: card(),
    purchases: [],
    payments: [
      payment({
        transaction_role: "cash_flow",
        financial_origin: "bank_account",
      }),
    ],
  });
  assert.equal(normalized.total, 11517.22);
  assert.equal(normalized.totalSource, "confirmed_by_full_payment");
  assert.equal(normalized.reconciliationDifference, 1564.12);
  assert.equal(normalized.payingAccountName, "Banco Santander");
});

test("pagamento parcial ou múltiplos pagamentos não confirmam o total", () => {
  const historical = invoice({
    calculated_invoice_total: 9953.1,
    paid_amount: 5000,
    status: "paid",
  });
  assert.equal(
    inferFullInvoicePayment(historical, card(), [
      payment({
        amount: 5000,
        description: "PAGAMENTO PARCIAL CARTAO MASTER",
      }),
    ]),
    null,
  );
  assert.equal(
    inferFullInvoicePayment(historical, card(), [
      payment({ id: "payment-1", amount: 5000 }),
      payment({ id: "payment-2", amount: 4953.1 }),
    ]),
    null,
  );
});

test("total oficial e confirmação manual prevalecem sobre pagamento inferido", () => {
  const provider = normalizeHistoricalInvoice({
    invoice: invoice({
      provider_invoice_total: 12000,
      manual_invoice_total: 11800,
      calculated_invoice_total: 9953.1,
      paid_amount: 11517.22,
      status: "paid",
    }),
    card: card(),
    purchases: [],
    payments: [payment()],
  });
  assert.equal(provider.total, 12000);
  assert.equal(provider.totalSource, "provider_bill");

  const manual = normalizeHistoricalInvoice({
    invoice: invoice({
      manual_invoice_total: 11517.22,
      calculated_invoice_total: 9953.1,
      paid_amount: 11517.22,
      status: "paid",
      total_source: "manual_pdf_confirmation",
    }),
    card: card(),
    purchases: [],
    payments: [payment()],
  });
  assert.equal(manual.total, 11517.22);
  assert.equal(manual.totalSource, "manual_pdf_confirmation");
});

test("pagamento só é associado ao ciclo histórico compatível", () => {
  const currentCycle = invoice({
    id: "invoice-august",
    reference_month: "2026-08-01",
    cycle_start_date: "2026-07-04",
    cycle_end_date: "2026-08-03",
    closing_date: "2026-08-03",
    due_date: "2026-08-10",
    paid_amount: 11517.22,
    status: "paid",
  });
  assert.equal(inferFullInvoicePayment(currentCycle, card(), [payment()]), null);
  assert.equal(
    inferFullInvoicePayment(
      invoice({ paid_amount: 11517.22, status: "paid" }),
      card(),
      [payment()],
    )?.id,
    "payment",
  );
});

test("normaliza ciclo, exclui compra externa e duplicada e separa pagamento", () => {
  const payment = {
    id: "payment",
    invoice_id: "invoice-july",
    transaction_role: "invoice_payment",
    amount: 200,
    realized_at: "2026-07-05T12:00:00Z",
    competence_date: "2026-07-05",
    financial_accounts: { name: "Santander", institution_name: "Santander" },
  } as FinancialTransaction;
  const normalized = normalizeHistoricalInvoice({
    invoice: invoice({ paid_amount: 200, status: "paid" }),
    card: card(),
    purchases: [
      purchase(),
      purchase({
        id: "outside",
        invoice_id: null,
        purchase_date: "2026-07-20",
        competence_date: "2026-07-20",
      }),
      purchase({
        id: "pending-version",
        external_id: "pending",
        status: "pending",
      }),
      purchase({
        id: "posted-version",
        external_id: "posted",
        status: "realized",
        purchase_date: "2026-06-21",
        competence_date: "2026-06-21",
      }),
      purchase({
        id: "payment-row",
        transaction_role: "invoice_payment",
      }),
    ],
    payments: [payment],
  });
  assert.equal(normalized.cycleStartDate, "2026-06-04");
  assert.equal(normalized.cycleEndDate, "2026-07-03");
  assert.deepEqual(
    normalized.purchases.map((item) => item.id).sort(),
    ["posted-version", "purchase"],
  );
  assert.equal(normalized.purchaseCount, 2);
  assert.deepEqual(normalized.payments.map((item) => item.id), ["payment"]);
  assert.equal(normalized.paidAt, "2026-07-05T12:00:00Z");
});

test("ordena e filtra por cartão, ano e status sem misturar Visa e Mastercard", () => {
  const mastercard = normalizeHistoricalInvoice({
    invoice: invoice(),
    card: card(),
    purchases: [purchase()],
    payments: [],
  });
  const visa = normalizeHistoricalInvoice({
    invoice: invoice({
      id: "visa-2025",
      card_id: "visa",
      due_date: "2025-12-10",
      status: "paid",
    }),
    card: card("visa", "Visa"),
    purchases: [
      purchase({
        id: "visa-purchase",
        card_id: "visa",
        invoice_id: "visa-2025",
      }),
    ],
    payments: [],
  });
  assert.deepEqual(
    sortHistoricalInvoices([visa, mastercard]).map((item) => item.id),
    ["invoice-july", "visa-2025"],
  );
  assert.deepEqual(
    filterHistoricalInvoices([visa, mastercard], {
      cardId: "visa",
      year: 2025,
      status: "paid",
    }).map((item) => item.id),
    ["visa-2025"],
  );
});

test("cursor é opaco, estável e suporta paginação", () => {
  assert.equal(encodeInvoiceHistoryCursor(12), "hc");
  assert.equal(decodeInvoiceHistoryCursor("hc"), 12);
  assert.equal(decodeInvoiceHistoryCursor("inválido"), 0);
});

test("histórico calcula mediana mensal e compara a fatura vigente", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "may",
      cardId: "mastercard",
      dueDate: "2026-05-10",
      status: "paid",
      total: 8000,
      totalSource: "provider_bill",
    },
    {
      id: "june-master",
      cardId: "mastercard",
      dueDate: "2026-06-10",
      status: "paid",
      total: 9000,
      totalSource: "provider_bill",
    },
    {
      id: "june-visa",
      cardId: "visa",
      dueDate: "2026-06-10",
      status: "paid",
      total: 1000,
      totalSource: "provider_bill",
    },
    {
      id: "july",
      cardId: "mastercard",
      dueDate: "2026-07-10",
      status: "closed",
      total: 11517.22,
      totalSource: "provider_bill",
    },
  ], 7397.25);

  assert.deepEqual(
    analytics.months.map(month => [month.month, month.total]),
    [["2026-05", 8000], ["2026-06", 10000], ["2026-07", 11517.22]],
  );
  assert.equal(analytics.median, 9000);
  assert.equal(analytics.currentDifference, 2517.22);
  assert.equal(analytics.currentDifferencePercentage, 27.97);
  assert.equal(analytics.currentPosition, "above");
});

test("organiza a fatura aberta no mês de pagamento sem criar barra Atual nem mês zero", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "july-paid", cardId: "mastercard", dueDate: "2026-07-10", status: "paid",
      total: 11517.22, totalSource: "provider_bill", paidAmount: 11517.22,
      paymentDate: "2026-07-10", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
    {
      id: "august-open", cardId: "mastercard", dueDate: "2026-08-10", status: "open",
      total: 7669.72, totalSource: "provider_bill", cycleStartDate: "2026-07-04",
      cycleEndDate: "2026-08-03", closingDate: "2026-08-03",
      paymentConfirmationStatus: "open", isConfirmed: false,
    },
  ], null);

  assert.deepEqual(analytics.months.map(item => [item.month, item.total, item.item.status]), [
    ["2026-07", 11517.22, "paid"],
    ["2026-08", 7669.72, "open"],
  ]);
  assert.equal(analytics.months.some(item => item.month === "current" || item.total === 0), false);
  assert.equal(analytics.median, 11517.22);
  assert.match(analytics.months[1].item.tooltip.cycleLabel ?? "", /04\/07\/2026 a 03\/08\/2026/);
});

test("pagamento confirmado mantém agosto pago e avança a próxima fatura aberta para setembro", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "august-paid", cardId: "mastercard", dueDate: "2026-08-10", status: "paid",
      total: 7669.72, totalSource: "provider_bill", paidAmount: 7702.14,
      paymentDate: "2026-08-10", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
    {
      id: "september-open", cardId: "mastercard", dueDate: "2026-09-10", status: "open",
      total: 1610.5, totalSource: "calculated_transactions", cycleStartDate: "2026-08-04",
      cycleEndDate: "2026-09-03", closingDate: "2026-09-03",
      paymentConfirmationStatus: "open", isConfirmed: false,
    },
  ], null);

  assert.deepEqual(analytics.months.map(item => [item.month, item.total, item.item.status]), [
    ["2026-08", 7702.14, "paid"],
    ["2026-09", 1610.5, "open"],
  ]);
  assert.equal(analytics.median, 7702.14);
  assert.equal(analytics.currentTotal, 1610.5);
});

test("pagamento bancário confirma histórico cujo total era apenas estimado", () => {
  const analytics = buildInvoiceHistoryAnalytics([{
    id: "estimated-paid", cardId: "mastercard", dueDate: "2026-05-10",
    status: "partially_paid", total: 9000,
    totalSource: "calculated_transactions", paidAmount: 8571.48,
    paymentDate: "2026-05-08", paymentConfirmationStatus: "partially_paid",
    paymentConfirmationSource: "bank_transaction",
  }], null);
  assert.deepEqual(
    analytics.months.map(item => [item.month, item.total, item.item.status]),
    [["2026-05", 8571.48, "paid"]],
  );
  assert.equal(analytics.median, 8571.48);
});

test("parcial permanece apenas quando há evidência explícita", () => {
  const analytics = buildInvoiceHistoryAnalytics([{
    id: "explicit-partial", cardId: "mastercard", dueDate: "2026-05-10",
    status: "partially_paid", total: 9000, totalSource: "provider_bill",
    paidAmount: 4500, paymentDate: "2026-05-08",
    paymentConfirmationStatus: "partially_paid",
    explicitPartialPayment: true,
  }], null);
  assert.equal(analytics.months[0].item.status, "partially_paid");
  assert.equal(analytics.months[0].item.participatesInMedian, false);
});

test("status pago legado não é mascarado por confirmação estimada", () => {
  const analytics = buildInvoiceHistoryAnalytics([{
    id: "legacy-paid", cardId: "mastercard", dueDate: "2026-04-10",
    status: "paid", total: 9352.54, totalSource: "calculated_transactions",
    paidAmount: 9352.54, paymentDate: "2026-04-10",
    paymentStatus: "paid", paymentConfirmationStatus: "estimated",
  }], null);
  assert.equal(analytics.months[0].item.status, "paid");
  assert.equal(analytics.months[0].item.participatesInMedian, true);
});

test("data do pagamento confirmado tem prioridade sobre vencimento e meses iguais são consolidados", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "late", cardId: "mastercard", dueDate: "2026-07-10", status: "paid",
      total: 400, totalSource: "provider_bill", paidAmount: 400,
      paymentDate: "2026-08-02", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
    {
      id: "regular", cardId: "visa", dueDate: "2026-08-12", status: "paid",
      total: 600, totalSource: "provider_bill", paidAmount: 600,
      paymentDate: "2026-08-12", paymentConfirmationStatus: "paid", isConfirmed: true,
    },
  ], null);
  assert.equal(analytics.months.length, 1);
  assert.equal(analytics.months[0].month, "2026-08");
  assert.equal(analytics.months[0].total, 1000);
  assert.equal(analytics.months[0].item.invoiceCount, 2);
  assert.equal(analytics.median, 1000);
  assert.equal(analytics.currentPosition, "unavailable");
});

test("faturas canceladas e sem total não distorcem a mediana", () => {
  const analytics = buildInvoiceHistoryAnalytics([
    {
      id: "cancelled",
      cardId: "mastercard",
      dueDate: "2026-06-10",
      status: "cancelled",
      total: 99999,
      totalSource: "manual_bank_confirmation",
    },
    {
      id: "unavailable",
      cardId: "mastercard",
      dueDate: "2026-07-10",
      status: "closed",
      total: null,
      totalSource: "unavailable",
    },
  ], null);
  assert.equal(analytics.median, null);
  assert.equal(analytics.currentPosition, "unavailable");
});

test("migrations aplicam escopo e reprocessamento idempotente do pagamento", () => {
  const migration = readFileSync(
    "supabase/migrations/202607250024_historical_invoice_workspace_rls.sql",
    "utf8",
  );
  assert.match(migration, /can_read_finance\(owner_id, workspace_id, visibility\)/);
  assert.match(migration, /can_write_finance\(owner_id, workspace_id, visibility\)/);
  assert.match(migration, /card_invoices_history_scope/);
  assert.match(migration, /sync_card_invoice_scope/);
  const reconciliationMigration = readFileSync(
    "supabase/migrations/202607260025_confirm_historical_invoices_by_payment.sql",
    "utf8",
  );
  assert.match(reconciliationMigration, /confirmed_invoice_total/);
  assert.match(reconciliationMigration, /confirmed_by_full_payment/);
  assert.match(reconciliationMigration, /invoice_match_count = 1/);
  assert.match(reconciliationMigration, /payment_match_count = 1/);
  assert.match(reconciliationMigration, /breakdown_metadata jsonb/);
  assert.match(reconciliationMigration, /reconcile_historical_invoice_payments/);
  const unclassifiedPaymentMigration = readFileSync(
    "supabase/migrations/202607260026_reconcile_unclassified_card_payments.sql",
    "utf8",
  );
  assert.match(unclassifiedPaymentMigration, /payment\.source_type = 'bank'/);
  assert.match(
    unclassifiedPaymentMigration,
    /\(PAGAMENTO\|PGTO\).*CARTAO.*MASTER/,
  );
  assert.match(unclassifiedPaymentMigration, /transaction_role = 'invoice_payment'/);
  assert.match(unclassifiedPaymentMigration, /get diagnostics changed_count = row_count/);
});
