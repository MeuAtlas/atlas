export type CardCycleMovementSource = "pdf" | "pluggy" | "manual" | "projection";
export type CardCycleMovementEntryType =
  | "purchase"
  | "installment_purchase"
  | "credit"
  | "refund"
  | "fee"
  | "interest"
  | "tax"
  | "adjustment";
export type CardMovementReconciliationStatus =
  | "matched"
  | "pdf_only"
  | "pluggy_only"
  | "projected_only"
  | "divergent"
  | "manual";

export interface CardCycleMovement {
  id: string;
  cycleId: string;
  billId: string | null;
  source: CardCycleMovementSource;
  sourceRecordId: string;
  reconciledSourceIds: string[];
  cardId: string | null;
  instrumentId: string | null;
  cardLabel: string;
  transactionDate: string | null;
  competenceMonth: string | null;
  description: string;
  merchantNormalized: string | null;
  amount: number;
  amountBrl: number | null;
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  exchangeRate: number | null;
  foreignIofAmount: number | null;
  conversionSource: string | null;
  convertedAt: string | null;
  postingDate: string | null;
  entryType: CardCycleMovementEntryType;
  installmentNumber: number | null;
  installmentTotal: number | null;
  providerTransactionId: string | null;
  invoiceEntryId: string | null;
  reconciliationStatus: CardMovementReconciliationStatus;
  effect: "debit" | "credit";
  categoryId?: string | null;
  reviewStatus?: string;
  createdAt?: string | null;
}

export type CardPurchaseCycleEvidence = {
  invoiceId?: string | null;
  providerBillId?: string | null;
  billForecastDate?: string | null;
  postingDate?: string | null;
  competenceDate?: string | null;
  purchaseDate: string;
};

export type CardCycleIdentity = {
  id: string;
  providerBillId?: string | null;
  referenceMonth: string;
  cycleStartDate: string;
  cycleEndDate: string;
  trustProviderAssignment?: boolean;
};

const withinCycle = (
  value: string | null | undefined,
  cycle: CardCycleIdentity,
) => Boolean(
  value &&
  value.slice(0, 10) >= cycle.cycleStartDate &&
  value.slice(0, 10) <= cycle.cycleEndDate,
);

const withinClosedCycleGrace = (
  value: string | null | undefined,
  cycle: CardCycleIdentity,
) => {
  if (!value || !cycle.trustProviderAssignment) return false;
  const graceStart = new Date(`${cycle.cycleStartDate}T12:00:00Z`);
  graceStart.setUTCDate(graceStart.getUTCDate() - 2);
  const date = value.slice(0, 10);
  return date >= graceStart.toISOString().slice(0, 10) &&
    date < cycle.cycleStartDate;
};

export function cardPurchaseBelongsToCycle(
  purchase: CardPurchaseCycleEvidence,
  cycle: CardCycleIdentity,
) {
  if (purchase.invoiceId && purchase.invoiceId !== cycle.id) return false;
  if (cycle.trustProviderAssignment && purchase.invoiceId) return true;
  if (
    purchase.providerBillId &&
    cycle.providerBillId &&
    purchase.providerBillId !== cycle.providerBillId
  ) return false;
  if (cycle.trustProviderAssignment && purchase.providerBillId) {
    return Boolean(
      cycle.providerBillId && purchase.providerBillId === cycle.providerBillId,
    );
  }
  if (purchase.postingDate) {
    return withinCycle(purchase.postingDate, cycle) ||
      withinClosedCycleGrace(purchase.postingDate, cycle);
  }
  if (cycle.trustProviderAssignment && purchase.billForecastDate) {
    return purchase.billForecastDate.slice(0, 7) ===
      cycle.referenceMonth.slice(0, 7);
  }
  if (purchase.competenceDate) {
    return withinCycle(purchase.competenceDate, cycle) ||
      withinClosedCycleGrace(purchase.competenceDate, cycle);
  }
  return withinCycle(purchase.purchaseDate, cycle) ||
    withinClosedCycleGrace(purchase.purchaseDate, cycle);
}

const debitEntryTypes = new Set([
  "purchase",
  "installment_purchase",
  "fee",
  "interest",
  "tax",
  "adjustment_debit",
]);
const creditEntryTypes = new Set([
  "credit",
  "refund",
  "adjustment_credit",
]);
const excludedEntryTypes = new Set([
  "payment",
  "previous_balance",
  "informational",
  "subtotal",
  "official_total",
  "future_balance",
  "unknown",
]);

export function resolveInvoiceEntryEffect(
  entryType: string,
  amount = 0,
): "debit" | "credit" | "exclude" {
  if (debitEntryTypes.has(entryType)) return "debit";
  if (creditEntryTypes.has(entryType)) return "credit";
  if (entryType === "adjustment") return amount < 0 ? "credit" : "debit";
  if (excludedEntryTypes.has(entryType)) return "exclude";
  return "exclude";
}

function sourcePriority(item: CardCycleMovement) {
  if (item.source === "pdf") return 5;
  if (item.source === "pluggy" && item.reconciliationStatus === "matched") return 4;
  if (item.source === "manual") return 3;
  if (item.source === "pluggy") return 2;
  return 1;
}

function normalizedMerchant(item: CardCycleMovement) {
  return (item.merchantNormalized || item.description)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

function dayDistance(left: string | null, right: string | null) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.abs(
    new Date(`${left}T12:00:00Z`).getTime() -
    new Date(`${right}T12:00:00Z`).getTime(),
  ) / 86_400_000;
}

function hasConflictingInstallmentDuplicate(
  left: CardCycleMovement,
  right: CardCycleMovement,
) {
  return (
    left.source === "pluggy" &&
    right.source === "pluggy" &&
    left.installmentTotal !== null &&
    left.installmentTotal === right.installmentTotal &&
    left.installmentTotal > 1 &&
    left.installmentNumber !== null &&
    right.installmentNumber !== null &&
    left.installmentNumber !== right.installmentNumber &&
    left.transactionDate !== null &&
    left.transactionDate === right.transactionDate
  );
}

function sameMovement(left: CardCycleMovement, right: CardCycleMovement) {
  if (
    left.invoiceEntryId &&
    right.invoiceEntryId &&
    left.invoiceEntryId === right.invoiceEntryId
  ) return true;
  if (
    left.providerTransactionId &&
    right.providerTransactionId &&
    left.providerTransactionId === right.providerTransactionId
  ) return true;
  if (
    left.providerTransactionId === right.sourceRecordId ||
    right.providerTransactionId === left.sourceRecordId ||
    left.reconciledSourceIds.includes(right.sourceRecordId) ||
    right.reconciledSourceIds.includes(left.sourceRecordId)
  ) return true;
  const leftMerchant = normalizedMerchant(left);
  const rightMerchant = normalizedMerchant(right);
  const merchantMatches =
    leftMerchant === rightMerchant ||
    (
      Math.min(leftMerchant.length, rightMerchant.length) >= 6 &&
      (
        leftMerchant.includes(rightMerchant) ||
        rightMerchant.includes(leftMerchant)
      )
    );
  if (
    left.cardId !== right.cardId ||
    (
      left.instrumentId &&
      right.instrumentId &&
      left.instrumentId !== right.instrumentId
    ) ||
    (
      Math.abs(left.amount - right.amount) > 0.01 &&
      !(
        left.originalAmount !== null &&
        right.originalAmount !== null &&
        left.originalCurrencyCode === right.originalCurrencyCode &&
        Math.abs(left.originalAmount - right.originalAmount) <= 0.01
      )
    ) ||
    !merchantMatches
  ) return false;
  if (left.installmentNumber !== right.installmentNumber) {
    // A single provider purchase must not produce two different installments
    // on the same card and posting date. This is a known incomplete-identity
    // shape from credit feeds; retain one monetary line instead of charging it
    // twice while leaving genuinely distinct dates untouched.
    return hasConflictingInstallmentDuplicate(left, right);
  }
  if (
    (left.source === "projection" || right.source === "projection") &&
    left.competenceMonth &&
    left.competenceMonth === right.competenceMonth
  ) return true;
  if (
    left.installmentNumber &&
    left.installmentTotal === right.installmentTotal
  ) return true;
  return dayDistance(left.transactionDate, right.transactionDate) <= 2;
}

export function deduplicateCardMovements(items: CardCycleMovement[]) {
  const result: CardCycleMovement[] = [];
  for (const candidate of [...items].sort((left, right) =>
    sourcePriority(right) - sourcePriority(left))) {
    const duplicateIndex = result.findIndex(item => sameMovement(item, candidate));
    if (duplicateIndex < 0) {
      result.push(candidate);
      continue;
    }
    const existing = result[duplicateIndex];
    const winner = sourcePriority(candidate) > sourcePriority(existing)
      ? candidate
      : existing;
    const loser = winner === candidate ? existing : candidate;
    result[duplicateIndex] = {
      ...winner,
      amountBrl: winner.amountBrl ?? loser.amountBrl,
      amount:
        winner.amountBrl ?? loser.amountBrl ?? winner.amount,
      originalAmount:
        winner.originalAmount ?? loser.originalAmount,
      originalCurrencyCode:
        winner.originalCurrencyCode ?? loser.originalCurrencyCode,
      exchangeRate:
        winner.exchangeRate ?? loser.exchangeRate,
      foreignIofAmount:
        winner.foreignIofAmount ?? loser.foreignIofAmount,
      conversionSource:
        winner.conversionSource ?? loser.conversionSource,
      convertedAt:
        winner.convertedAt ?? loser.convertedAt,
      postingDate:
        winner.postingDate ?? loser.postingDate,
      reconciledSourceIds: [...new Set([
        ...winner.reconciledSourceIds,
        ...loser.reconciledSourceIds,
        loser.sourceRecordId,
      ])],
      reconciliationStatus: "matched",
    };
  }
  return result;
}

export function getOpenCardCycleMovements(items: CardCycleMovement[]) {
  return deduplicateCardMovements(
    items.filter(item =>
      item.source === "pluggy" ||
      item.source === "manual" ||
      item.source === "projection"),
  );
}

export function getClosedCardCycleMovements(items: CardCycleMovement[]) {
  return deduplicateCardMovements(items);
}

export function summarizeCardCycleMovements(items: CardCycleMovement[]) {
  let launchedPurchases = 0;
  let projectedInstallments = 0;
  let credits = 0;
  for (const item of items) {
    if (item.effect === "credit") {
      credits += item.amount;
    } else if (item.source === "projection") {
      projectedInstallments += item.amount;
    } else {
      launchedPurchases += item.amount;
    }
  }
  return {
    launchedPurchases,
    projectedInstallments,
    credits,
    projection: launchedPurchases + projectedInstallments - credits,
  };
}
