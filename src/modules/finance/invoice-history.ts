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
};

export type CreditCardInvoiceHistoryResult = {
  invoices: CreditCardInvoiceHistoryItem[];
  nextCursor: string | null;
  totalCount: number;
  warnings: string[];
  dataCompleteness: "complete" | "partial" | "unavailable";
};

const amountOrNull = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

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

export function resolveHistoricalInvoiceTotal(invoice: StoredCardInvoice): {
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
      uniquePurchases.length > 0
        ? calculated.purchaseCount
        : Math.max(0, Number(invoice.purchase_count ?? 0)),
    reconciliationStatus,
    dataCompleteness: resolved.total === null ? "unavailable" : partial ? "partial" : "complete",
    purchases: uniquePurchases,
    payments: linkedPayments,
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
