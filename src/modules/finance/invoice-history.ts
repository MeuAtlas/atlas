import {
  calculateInvoiceAmounts,
  deduplicateCardPurchases,
  purchaseCompetenceDate,
} from "./card-invoices";
import type {
  CardPurchase,
  CreditCard,
  FinancialTransaction,
  StoredCardInvoice,
} from "./types";

export const HISTORICAL_INVOICE_STATUSES = [
  "closed",
  "due",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const;

export type HistoricalInvoiceStatus =
  (typeof HISTORICAL_INVOICE_STATUSES)[number];
export type InvoiceTotalSource =
  | "provider_bill"
  | "manual_pdf_confirmation"
  | "manual_bank_confirmation"
  | "confirmed_by_full_payment"
  | "calculated_transactions"
  | "unavailable";

export type CreditCardInvoiceHistoryItem = {
  id: string;
  documentId?: string | null;
  cardId: string;
  cardName: string;
  institutionName: string | null;
  brand: string | null;
  lastFour: string | null;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  closingDate: string;
  dueDate: string;
  status: HistoricalInvoiceStatus;
  total: number | null;
  totalSource: InvoiceTotalSource;
  calculatedTotal: number | null;
  reconciliationDifference: number | null;
  paidAmount: number;
  paidAt: string | null;
  payingAccountName: string | null;
  purchaseCount: number;
  reconciliationStatus: string;
  dataCompleteness: "complete" | "partial" | "unavailable";
  purchases: CardPurchase[];
  payments: FinancialTransaction[];
  pdfEntries?: Array<{
    id: string;
    transactionDate: string | null;
    description: string;
    amount: number;
    entryType: string;
    cardLastFour: string | null;
    installmentNumber: number | null;
    installmentTotal: number | null;
    confidence: number;
    reconciledWithProvider: boolean;
  }>;
};

export type CreditCardInvoiceHistoryResult = {
  invoices: CreditCardInvoiceHistoryItem[];
  nextCursor: string | null;
  totalCount: number;
  warnings: string[];
  dataCompleteness: "complete" | "partial" | "unavailable";
};

export type InvoiceHistoryAnalyticsEntry = Pick<
  CreditCardInvoiceHistoryItem,
  "id" | "cardId" | "dueDate" | "total" | "totalSource"
> & {
  status: StoredCardInvoice["status"];
  cycleStartDate?: string | null;
  cycleEndDate?: string | null;
  closingDate?: string | null;
  expectedPaymentDate?: string | null;
  paymentDate?: string | null;
  paidAmount?: number | null;
  reliableTotal?: number | null;
  estimatedTotal?: number | null;
  paymentConfirmationStatus?: string | null;
  paymentConfirmationSource?: string | null;
  paymentStatus?: string | null;
  explicitPartialPayment?: boolean;
  isConfirmed?: boolean;
};

export type StatementHistoryStatus =
  | "paid"
  | "open"
  | "closed_unpaid"
  | "payment_detected"
  | "partially_paid"
  | "estimated"
  | "missing"
  | "cancelled";

export type StatementHistoryChartItem = {
  statementId: string;
  statementIds: string[];
  year: number;
  month: number;
  cashMonth: string;
  monthLabel: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  closingDate: string | null;
  dueDate: string | null;
  paymentDate: string | null;
  status: StatementHistoryStatus;
  statusLabel: string;
  paidAmount: number | null;
  displayAmount: number | null;
  amountSource: "paid_amount" | "bank_total" | "reliable_total" | "estimated_total";
  participatesInMedian: boolean;
  isCurrentOpenStatement: boolean;
  isConfirmed: boolean;
  invoiceCount: number;
  tooltip: {
    title: string;
    cycleLabel: string | null;
    closingLabel: string | null;
    dueLabel: string | null;
    paymentLabel: string | null;
    statusLabel: string;
    sourceLabel: string;
  };
};

export type InvoiceHistoryAnalytics = {
  months: Array<{
    month: string;
    total: number;
    invoiceCount: number;
    item: StatementHistoryChartItem;
  }>;
  median: number | null;
  average: number | null;
  minimum: number | null;
  maximum: number | null;
  currentTotal: number | null;
  currentDifference: number | null;
  currentDifferencePercentage: number | null;
  currentPosition: "above" | "below" | "equal" | "unavailable";
};

const amountOrNull = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

const roundedMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : roundedMoney((sorted[middle - 1] + sorted[middle]) / 2);
}

const dateMonth = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : null;

function nextMonth(value: string) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return date.toISOString().slice(0, 7);
}

/** Cash-basis month shared by card history and monthly-report projections. */
export function getStatementCashMonth(statement: InvoiceHistoryAnalyticsEntry) {
  return dateMonth(statement.paymentDate) ??
    dateMonth(statement.dueDate) ??
    dateMonth(statement.expectedPaymentDate) ??
    (dateMonth(statement.closingDate) ? nextMonth(statement.closingDate!) : null) ??
    dateMonth(statement.dueDate) ??
    dateMonth(statement.cycleEndDate);
}

function chartStatus(statement: InvoiceHistoryAnalyticsEntry): StatementHistoryStatus {
  if (statement.status === "cancelled" || statement.paymentConfirmationStatus === "cancelled") return "cancelled";
  const confirmation = statement.paymentConfirmationStatus;
  const paid = amountOrNull(statement.paidAmount);
  if (statement.status === "paid" || statement.paymentStatus === "paid") return "paid";
  if (
    paid !== null &&
    paid > 0 &&
    statement.status !== "open" &&
    !statement.explicitPartialPayment
  ) return "paid";
  if (["paid", "manually_confirmed", "overpaid"].includes(confirmation ?? "")) return "paid";
  if (confirmation === "partially_paid" || statement.status === "partially_paid") return "partially_paid";
  if (["payment_detected", "payment_mismatch"].includes(confirmation ?? "")) return "payment_detected";
  if (statement.status === "open" || confirmation === "open") return "open";
  if (["closed", "due", "overdue"].includes(statement.status)) return "closed_unpaid";
  return "estimated";
}

const STATUS_LABELS: Record<StatementHistoryStatus, string> = {
  paid: "Paga",
  open: "Em aberto",
  closed_unpaid: "Aguardando pagamento",
  payment_detected: "Pagamento encontrado",
  partially_paid: "Parcialmente paga",
  estimated: "Estimativa",
  missing: "Sem fatura identificada",
  cancelled: "Cancelada",
};

export function getStatementChartDisplayAmount(statement: InvoiceHistoryAnalyticsEntry) {
  const status = chartStatus(statement);
  const paid = amountOrNull(statement.paidAmount);
  if (status === "paid" && paid !== null && paid > 0) {
    return { amount: paid, source: "paid_amount" as const };
  }
  if (status === "partially_paid" && paid !== null && paid > 0) {
    return { amount: paid, source: "paid_amount" as const };
  }
  const official = amountOrNull(statement.total);
  if (official !== null && official > 0) return { amount: official, source: "bank_total" as const };
  const reliable = amountOrNull(statement.reliableTotal);
  if (reliable !== null && reliable > 0) return { amount: reliable, source: "reliable_total" as const };
  const estimated = amountOrNull(statement.estimatedTotal);
  return { amount: estimated && estimated > 0 ? estimated : null, source: "estimated_total" as const };
}

const isoDateLabel = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
  : null;

function sourceLabel(source: StatementHistoryChartItem["amountSource"], status: StatementHistoryStatus) {
  if (source === "paid_amount") return "Pagamento identificado na conta";
  if (source === "bank_total") return "Total oficial ou informado pela instituição";
  if (source === "reliable_total") return "Último total confiável";
  return status === "estimated" ? "Estimativa das compras identificadas" : "Total calculado";
}

function toChartItem(statement: InvoiceHistoryAnalyticsEntry): StatementHistoryChartItem | null {
  const cashMonth = getStatementCashMonth(statement);
  const status = chartStatus(statement);
  if (!cashMonth || status === "cancelled") return null;
  const display = getStatementChartDisplayAmount(statement);
  if (display.amount === null) return null;
  const confirmed = statement.isConfirmed ?? status === "paid";
  const [year, month] = cashMonth.split("-").map(Number);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${cashMonth}-01T12:00:00Z`));
  return {
    statementId: statement.id,
    statementIds: [statement.id],
    year,
    month,
    cashMonth,
    monthLabel,
    cycleStartDate: statement.cycleStartDate ?? null,
    cycleEndDate: statement.cycleEndDate ?? null,
    closingDate: statement.closingDate ?? null,
    dueDate: statement.dueDate ?? null,
    paymentDate: statement.paymentDate ?? null,
    status,
    statusLabel: STATUS_LABELS[status],
    paidAmount: display.source === "paid_amount" ? display.amount : null,
    displayAmount: display.amount,
    amountSource: display.source,
    participatesInMedian: status === "paid" && confirmed && display.amount > 0,
    isCurrentOpenStatement: ["open", "closed_unpaid", "payment_detected", "partially_paid", "estimated"].includes(status),
    isConfirmed: confirmed,
    invoiceCount: 1,
    tooltip: {
      title: monthLabel,
      cycleLabel: statement.cycleStartDate && statement.cycleEndDate
        ? `${isoDateLabel(statement.cycleStartDate)} a ${isoDateLabel(statement.cycleEndDate)}` : null,
      closingLabel: isoDateLabel(statement.closingDate),
      dueLabel: isoDateLabel(statement.dueDate),
      paymentLabel: status === "paid" ? isoDateLabel(statement.paymentDate) : null,
      statusLabel: STATUS_LABELS[status],
      sourceLabel: sourceLabel(display.source, status),
    },
  };
}

const statusPriority: Record<StatementHistoryStatus, number> = {
  open: 8, payment_detected: 7, partially_paid: 6, closed_unpaid: 5,
  estimated: 4, paid: 3, missing: 2, cancelled: 1,
};

export function aggregateStatementsByCashMonth(statements: InvoiceHistoryAnalyticsEntry[]) {
  const grouped = new Map<string, StatementHistoryChartItem>();
  for (const statement of statements) {
    const item = toChartItem(statement);
    if (!item || item.displayAmount === null) continue;
    const current = grouped.get(item.cashMonth);
    if (!current) { grouped.set(item.cashMonth, item); continue; }
    const dominant = statusPriority[item.status] > statusPriority[current.status] ? item : current;
    const combinedAmount = roundedMoney((current.displayAmount ?? 0) + item.displayAmount);
    grouped.set(item.cashMonth, {
      ...dominant,
      statementId: current.statementId,
      statementIds: [...current.statementIds, ...item.statementIds],
      displayAmount: combinedAmount,
      paidAmount: current.participatesInMedian && item.participatesInMedian ? combinedAmount : dominant.paidAmount,
      participatesInMedian: current.participatesInMedian && item.participatesInMedian,
      isConfirmed: current.isConfirmed && item.isConfirmed,
      invoiceCount: current.invoiceCount + item.invoiceCount,
    });
  }
  return [...grouped.values()].sort((left, right) => left.cashMonth.localeCompare(right.cashMonth));
}

export function calculatePaidStatementMedian(items: StatementHistoryChartItem[]) {
  return median(items.flatMap(item => item.participatesInMedian && item.displayAmount && item.displayAmount > 0 ? [item.displayAmount] : []));
}

export function getStatementForCashMonth(statements: InvoiceHistoryAnalyticsEntry[], cashMonth: string) {
  return aggregateStatementsByCashMonth(statements).find(item => item.cashMonth === cashMonth) ?? null;
}

export function buildInvoiceHistoryAnalytics(
  invoices: InvoiceHistoryAnalyticsEntry[],
  currentTotal: number | null,
  monthLimit = 12,
): InvoiceHistoryAnalytics {
  const allItems = aggregateStatementsByCashMonth(invoices);
  const currentItem = [...allItems].reverse().find(item => item.isCurrentOpenStatement) ?? null;
  const paidItems = allItems.filter(item => item.participatesInMedian);
  const chartItems = allItems.slice(-Math.max(1, monthLimit));
  const months = chartItems.map(item => ({
    month: item.cashMonth,
    total: item.displayAmount ?? 0,
    invoiceCount: item.invoiceCount,
    item,
  }));
  const totals = paidItems.map(item => item.displayAmount ?? 0).filter(value => value > 0);
  const historicalMedian = calculatePaidStatementMedian(paidItems);
  const average = totals.length
    ? roundedMoney(totals.reduce((sum, value) => sum + value, 0) / totals.length)
    : null;
  const normalizedCurrent = currentItem?.displayAmount ?? amountOrNull(currentTotal);
  const currentDifference =
    normalizedCurrent !== null && historicalMedian !== null
      ? roundedMoney(normalizedCurrent - historicalMedian)
      : null;
  const currentDifferencePercentage =
    currentDifference !== null && historicalMedian !== null && historicalMedian > 0
      ? roundedMoney((currentDifference / historicalMedian) * 100)
      : null;
  const currentPosition =
    currentDifference === null
      ? "unavailable" as const
      : Math.abs(currentDifference) <= 0.01
        ? "equal" as const
        : currentDifference > 0
          ? "above" as const
          : "below" as const;
  return {
    months,
    median: historicalMedian,
    average,
    minimum: totals.length ? Math.min(...totals) : null,
    maximum: totals.length ? Math.max(...totals) : null,
    currentTotal: normalizedCurrent,
    currentDifference,
    currentDifferencePercentage,
    currentPosition,
  };
}

export function isHistoricalInvoice(invoice: StoredCardInvoice, today: string) {
  if (
    !HISTORICAL_INVOICE_STATUSES.includes(
      invoice.status as HistoricalInvoiceStatus,
    )
  ) {
    return false;
  }
  if (invoice.status === "due" && invoice.closing_date >= today) return false;
  return invoice.closing_date < today;
}

export function resolveHistoricalInvoiceTotal(invoice: Pick<
  StoredCardInvoice,
  | "provider_invoice_total"
  | "manual_invoice_total"
  | "confirmed_invoice_total"
  | "calculated_invoice_total"
  | "total_source"
>): {
  total: number | null;
  source: InvoiceTotalSource;
} {
  const provider = amountOrNull(invoice.provider_invoice_total);
  if (provider !== null) return { total: provider, source: "provider_bill" };
  const manual = amountOrNull(invoice.manual_invoice_total);
  if (manual !== null) {
    return {
      total: manual,
      source:
        invoice.total_source === "manual_pdf_confirmation"
          ? "manual_pdf_confirmation"
          : "manual_bank_confirmation",
    };
  }
  const confirmed = amountOrNull(invoice.confirmed_invoice_total);
  if (confirmed !== null) {
    return { total: confirmed, source: "confirmed_by_full_payment" };
  }
  const calculated = amountOrNull(invoice.calculated_invoice_total);
  if (calculated !== null) {
    return { total: calculated, source: "calculated_transactions" };
  }
  return { total: null, source: "unavailable" };
}

const paymentDate = (payment: FinancialTransaction) =>
  (payment.realized_at ?? payment.competence_date).slice(0, 10);

const normalizedText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("pt-BR");

function paymentMatchesCard(
  payment: FinancialTransaction,
  invoice: StoredCardInvoice,
  card: CreditCard,
) {
  if (payment.invoice_id === invoice.id || payment.credit_card_id === card.id) {
    return true;
  }
  const description = normalizedText(payment.description);
  if (
    card.last_four_digits &&
    description.includes(card.last_four_digits)
  ) {
    return true;
  }
  const brand = normalizedText(card.brand ?? "");
  if (brand.includes("MASTER") && description.includes("MASTER")) return true;
  if (brand.includes("VISA") && description.includes("VISA")) return true;
  return false;
}

function compatibleInvoicePayments(
  invoice: StoredCardInvoice,
  card: CreditCard,
  payments: FinancialTransaction[],
) {
  return payments.filter((payment) => {
    const description = normalizedText(payment.description);
    const explicitlyClassified =
      payment.transaction_role === "invoice_payment";
    const recognizableBankPayment =
      payment.source_type === "bank" &&
      payment.bank_direction === "outflow" &&
      /(?:PAGAMENTO|PGTO).*CARTAO.*(?:CREDITO|MASTER|VISA)/.test(description);
    if (!explicitlyClassified && !recognizableBankPayment) return false;
    if (["cancelled", "pending", "forecast"].includes(payment.status)) {
      return false;
    }
    if (payment.bank_direction === "inflow") return false;
    const date = paymentDate(payment);
    if (date <= invoice.closing_date || date > invoice.due_date) return false;
    if (/(PARCIAL|MINIM[OA]|FINANCI|ROTATIV)/.test(description)) return false;
    return paymentMatchesCard(payment, invoice, card);
  });
}

export function inferFullInvoicePayment(
  invoice: StoredCardInvoice,
  card: CreditCard,
  payments: FinancialTransaction[],
) {
  const compatible = compatibleInvoicePayments(invoice, card, payments);
  if (compatible.length !== 1) return null;
  if (!["closed", "paid"].includes(invoice.status)) return null;
  if (Number(invoice.outstanding_amount) > 0) return null;
  const payment = compatible[0];
  const paid = amountOrNull(payment.amount);
  if (paid === null) return null;
  const minimumPayment = amountOrNull(invoice.minimum_payment_amount);
  if (minimumPayment !== null && Math.abs(minimumPayment - paid) <= 0.01) {
    return null;
  }
  const storedPaid = amountOrNull(invoice.paid_amount);
  if (storedPaid !== null && storedPaid > 0 && Math.abs(storedPaid - paid) > 0.01) {
    return null;
  }
  return payment;
}

function purchaseBelongsToInvoice(
  purchase: CardPurchase,
  invoice: StoredCardInvoice,
) {
  if (purchase.card_id !== invoice.card_id || purchase.status === "cancelled") {
    return false;
  }
  if (purchase.invoice_id) return purchase.invoice_id === invoice.id;
  const date = purchaseCompetenceDate(purchase);
  return Boolean(
    invoice.cycle_start_date &&
      invoice.cycle_end_date &&
      date >= invoice.cycle_start_date &&
      date <= invoice.cycle_end_date,
  );
}

export function normalizeHistoricalInvoice({
  invoice,
  card,
  purchases,
  payments,
}: {
  invoice: StoredCardInvoice;
  card: CreditCard;
  purchases: CardPurchase[];
  payments: FinancialTransaction[];
}): CreditCardInvoiceHistoryItem {
  const uniquePurchases = deduplicateCardPurchases(
    purchases.filter(
      (purchase) =>
        purchase.transaction_role !== "invoice_payment" &&
        purchaseBelongsToInvoice(purchase, invoice),
    ),
  );
  const rawPdfEntries = ((invoice as StoredCardInvoice & {
    invoice_entries?: Array<Record<string, unknown>>;
  }).invoice_entries ?? []);
  const pdfEntries = rawPdfEntries.map(item => ({
    id: String(item.id),
    transactionDate: item.transaction_date ? String(item.transaction_date) : null,
    description: String(item.description_raw ?? ""),
    amount: Number(item.amount ?? 0),
    entryType: String(item.entry_type ?? "unknown"),
    cardLastFour: item.card_last_four ? String(item.card_last_four) : null,
    installmentNumber: item.installment_number === null ? null : Number(item.installment_number),
    installmentTotal: item.installment_total === null ? null : Number(item.installment_total),
    confidence: Number(item.confidence ?? 0),
    reconciledWithProvider: Boolean(item.provider_transaction_id),
  }));
  const reconciledProviderIds = new Set(
    rawPdfEntries.map(item => item.provider_transaction_id ? String(item.provider_transaction_id) : null)
      .filter((value): value is string => Boolean(value)),
  );
  const unmatchedProviderPurchases = uniquePurchases.filter(
    purchase => !purchase.external_id || !reconciledProviderIds.has(purchase.external_id),
  );
  const calculated = calculateInvoiceAmounts(uniquePurchases);
  const calculatedTotal =
    amountOrNull(invoice.calculated_invoice_total) ?? calculated.invoiceTotal;
  const fullPayment = inferFullInvoicePayment(invoice, card, payments);
  const storedResolved = resolveHistoricalInvoiceTotal(invoice);
  const paymentConfirmedTotal = fullPayment
    ? amountOrNull(fullPayment.amount)
    : null;
  const resolved =
    storedResolved.source === "calculated_transactions" &&
    paymentConfirmedTotal !== null
      ? {
          total: paymentConfirmedTotal,
          source: "confirmed_by_full_payment" as const,
        }
      : storedResolved.source === "unavailable" &&
          paymentConfirmedTotal !== null
        ? {
            total: paymentConfirmedTotal,
            source: "confirmed_by_full_payment" as const,
          }
        : storedResolved;
  const providerTotal = amountOrNull(invoice.provider_invoice_total);
  const difference =
    resolved.total !== null && calculatedTotal !== null
      ? Number((resolved.total - calculatedTotal).toFixed(2))
      : null;
  const reconciliationStatus =
    difference === null
      ? "unavailable"
      : Math.abs(difference) <= 0.01
        ? "matched"
        : "incomplete";
  const partial =
    resolved.total === null ||
    reconciliationStatus === "incomplete" ||
    (providerTotal !== null &&
      calculatedTotal !== null &&
      Math.abs(providerTotal - calculatedTotal) > 0.01);
  const linkedPayments = fullPayment
    ? [fullPayment]
    : compatibleInvoicePayments(invoice, card, payments).filter(
        (payment) => payment.invoice_id === invoice.id,
      );
  const paidAmount =
    linkedPayments.length === 1
      ? amountOrNull(linkedPayments[0].amount) ?? 0
      : amountOrNull(invoice.paid_amount) ?? 0;
  const payment = linkedPayments[0];

  return {
    id: invoice.id,
    documentId: (invoice as StoredCardInvoice & { document_id?: string | null }).document_id ?? null,
    cardId: invoice.card_id,
    cardName: card.name,
    institutionName: card.institution_name,
    brand: card.brand,
    lastFour: card.last_four_digits,
    cycleStartDate: invoice.cycle_start_date,
    cycleEndDate: invoice.cycle_end_date,
    closingDate: invoice.closing_date,
    dueDate: invoice.due_date,
    status: invoice.status as HistoricalInvoiceStatus,
    total: resolved.total,
    totalSource: resolved.source,
    calculatedTotal,
    reconciliationDifference: difference,
    paidAmount,
    paidAt:
      invoice.paid_at ??
      linkedPayments
        .map((item) => item.realized_at ?? item.competence_date)
        .sort()
        .at(-1) ??
      null,
    payingAccountName:
      payment?.financial_accounts?.institution_name ??
      payment?.financial_accounts?.name ??
      null,
    purchaseCount:
      pdfEntries.length > 0
        ? pdfEntries.length
        : uniquePurchases.length > 0
        ? calculated.purchaseCount
        : Math.max(0, Number(invoice.purchase_count ?? 0)),
    reconciliationStatus,
    dataCompleteness: resolved.total === null ? "unavailable" : partial ? "partial" : "complete",
    purchases: unmatchedProviderPurchases,
    payments: linkedPayments,
    pdfEntries,
  };
}

export function sortHistoricalInvoices(
  invoices: CreditCardInvoiceHistoryItem[],
) {
  return [...invoices].sort(
    (left, right) =>
      right.dueDate.localeCompare(left.dueDate) ||
      right.id.localeCompare(left.id),
  );
}

export function filterHistoricalInvoices(
  invoices: CreditCardInvoiceHistoryItem[],
  filters: {
    cardId?: string;
    year?: number;
    status?: HistoricalInvoiceStatus;
  },
) {
  return sortHistoricalInvoices(
    invoices.filter(
      (invoice) =>
        (!filters.cardId || invoice.cardId === filters.cardId) &&
        (!filters.year ||
          Number(invoice.dueDate.slice(0, 4)) === filters.year) &&
        (!filters.status || invoice.status === filters.status),
    ),
  );
}

export function encodeInvoiceHistoryCursor(offset: number) {
  return `h${Math.max(0, Math.trunc(offset)).toString(36)}`;
}

export function decodeInvoiceHistoryCursor(cursor?: string | null) {
  if (!cursor || !/^h[0-9a-z]+$/i.test(cursor)) return 0;
  const value = Number.parseInt(cursor.slice(1), 36);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
