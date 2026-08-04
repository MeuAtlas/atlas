export type StatementDataSource =
  | "pluggy_open_estimate"
  | "pluggy_bill"
  | "statement_pdf"
  | "bank_payment"
  | "manual";

export type StatementLifecycleStatus =
  | "open"
  | "closed"
  | "due"
  | "overdue"
  | "cancelled";

export type StatementDetailsStatus =
  | "estimated"
  | "awaiting_pdf"
  | "confirmed"
  | "unavailable";

export type StatementPaymentStatus =
  | "unpaid"
  | "payment_detected"
  | "partially_paid"
  | "paid"
  | "overpaid"
  | "payment_mismatch"
  | "cancelled";

type Amount = number | string | null | undefined;

export type StatementTotalInput = {
  lifecycleStatus: StatementLifecycleStatus;
  pdfTotal?: Amount;
  pluggyBillTotal?: Amount;
  manualTotal?: Amount;
  calculatedTotal?: Amount;
  openEstimate?: Amount;
};

export type ResolvedStatementTotal = {
  amount: number | null;
  source: StatementDataSource | null;
  definitive: boolean;
};

const amount = (value: Amount) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

/**
 * One source-priority rule shared by cards, reports and planning.
 * A confirmed PDF is the final detailed statement. Pluggy Bill remains the
 * official closed total when no PDF was confirmed. Open values are estimates.
 */
export function resolveStatementTotal(
  input: StatementTotalInput,
): ResolvedStatementTotal {
  const pdfTotal = amount(input.pdfTotal);
  if (pdfTotal !== null) {
    return { amount: pdfTotal, source: "statement_pdf", definitive: true };
  }

  const billTotal = amount(input.pluggyBillTotal);
  if (billTotal !== null) {
    return { amount: billTotal, source: "pluggy_bill", definitive: true };
  }

  const manualTotal = amount(input.manualTotal);
  if (manualTotal !== null) {
    return { amount: manualTotal, source: "manual", definitive: true };
  }

  const estimated = amount(input.openEstimate) ?? amount(input.calculatedTotal);
  return {
    amount: estimated,
    source: estimated === null ? null : "pluggy_open_estimate",
    definitive: false,
  };
}

export function resolveStatementDetailsStatus(input: {
  lifecycleStatus: StatementLifecycleStatus;
  hasConfirmedPdf: boolean;
  hasProvisionalEntries?: boolean;
}): StatementDetailsStatus {
  if (input.hasConfirmedPdf) return "confirmed";
  if (input.lifecycleStatus === "cancelled") return "unavailable";
  if (input.lifecycleStatus === "open") {
    return input.hasProvisionalEntries ? "estimated" : "unavailable";
  }
  return "awaiting_pdf";
}

export function normalizeStatementLifecycleStatus(
  status: string,
): StatementLifecycleStatus {
  if (status === "open" || status === "estimated") return "open";
  if (status === "due") return "due";
  if (status === "overdue") return "overdue";
  if (status === "cancelled") return "cancelled";
  return "closed";
}

export function normalizeStatementPaymentStatus(input: {
  lifecycleStatus: StatementLifecycleStatus;
  paymentConfirmationStatus?: string | null;
  paidAmount?: Amount;
  expectedAmount?: Amount;
}): StatementPaymentStatus {
  if (input.lifecycleStatus === "cancelled") return "cancelled";
  const status = input.paymentConfirmationStatus ?? "";
  if (status === "overpaid") return "overpaid";
  if (status === "payment_mismatch") return "payment_mismatch";
  if (status === "payment_detected") return "payment_detected";
  if (status === "partially_paid") return "partially_paid";
  if (status === "paid" || status === "manually_confirmed") return "paid";

  const paid = amount(input.paidAmount) ?? 0;
  const expected = amount(input.expectedAmount);
  if (paid > 0 && expected !== null) {
    if (paid > expected + .01) return "overpaid";
    if (paid + .01 >= expected) return "paid";
    return "partially_paid";
  }
  return "unpaid";
}

export type CreditCardStatementViewModel = {
  lifecycleStatus: StatementLifecycleStatus;
  detailsStatus: StatementDetailsStatus;
  paymentStatus: StatementPaymentStatus;
  total: number | null;
  totalSource: StatementDataSource | null;
  totalIsDefinitive: boolean;
  paidAmount: number;
  remainingAmount: number | null;
  canAttachPdf: boolean;
  showProvisionalEntries: boolean;
};

export function buildCreditCardStatementViewModel(input: StatementTotalInput & {
  hasConfirmedPdf: boolean;
  hasProvisionalEntries?: boolean;
  paymentConfirmationStatus?: string | null;
  paidAmount?: Amount;
}): CreditCardStatementViewModel {
  const resolved = resolveStatementTotal(input);
  const detailsStatus = resolveStatementDetailsStatus(input);
  const paid = amount(input.paidAmount) ?? 0;
  return {
    lifecycleStatus: input.lifecycleStatus,
    detailsStatus,
    paymentStatus: normalizeStatementPaymentStatus({
      lifecycleStatus: input.lifecycleStatus,
      paymentConfirmationStatus: input.paymentConfirmationStatus,
      paidAmount: paid,
      expectedAmount: resolved.amount,
    }),
    total: resolved.amount,
    totalSource: resolved.source,
    totalIsDefinitive: resolved.definitive,
    paidAmount: paid,
    remainingAmount: resolved.amount === null
      ? null
      : Math.max(0, Math.round((resolved.amount - paid) * 100) / 100),
    canAttachPdf: input.lifecycleStatus !== "open" && input.lifecycleStatus !== "cancelled",
    showProvisionalEntries: detailsStatus !== "confirmed" && Boolean(input.hasProvisionalEntries),
  };
}
