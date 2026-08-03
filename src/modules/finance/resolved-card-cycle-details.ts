import {
  calculateOpenCardCycleBreakdown,
  classifyOpenCardCycleMovement,
  type InstallmentsDataStatus,
  type OpenCardCycleEntryClassification,
} from "./open-card-cycle";
import type { AvailableCardCycle } from "./card-cycles";
import type { ResolvedOpenCardInvoice } from "./open-card-invoice";
import type { CardPurchase } from "./types";

export type ConfirmedCardCycleTotalSource =
  | "pluggy_current"
  | "pluggy_last_reliable"
  | "pdf"
  | "manual"
  | "calculated"
  | "unavailable";

export type CardCycleMovementDTO = {
  id: string;
  sourceRecordId: string;
  date: string;
  postingDate: string | null;
  description: string;
  cardId: string;
  instrumentId: string | null;
  cardLabel: string;
  entryType: string;
  classification: OpenCardCycleEntryClassification;
  source: "pdf" | "pluggy" | "manual" | "projection";
  status: string;
  reconciliationStatus: string | null;
  reviewStatus: string;
  amountBrl: number | null;
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  exchangeRate: number | null;
  foreignIofAmount: number | null;
  conversionSource: string | null;
  conversionConfidence: number | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  effect: "debit" | "credit";
  lowConfidence: boolean;
};

export type CardCycleInstallmentDTO = {
  id: string;
  movementId: string;
  description: string;
  cardLabel: string;
  installmentNumber: number;
  installmentTotal: number;
  amountBrl: number | null;
  source: CardCycleMovementDTO["source"];
  status: "posted" | "projected" | "reconciled" | "divergent";
  nextInstallments: number;
};

export type ResolvedCardCycleDetails = {
  cycle: {
    id: string;
    status: "open" | "closed" | "paid" | "overdue";
    cycleStartDate: string;
    cycleEndDate: string;
    closingDate: string | null;
    dueDate: string | null;
    referenceMonth: string | null;
    cardAccountId: string;
    cardIds: string[];
    cardLabels: string[];
    cardName: string;
    cardBrand: string | null;
    cardLastFour: string | null;
  };
  totals: {
    confirmedTotal: number | null;
    confirmedTotalSource: ConfirmedCardCycleTotalSource;
    newPurchasesTotal: number | null;
    postedInstallmentsTotal: number | null;
    projectedInstallmentsTotal: number | null;
    feesAndTaxesTotal: number | null;
    creditsAndRefundsTotal: number | null;
    detailedTotal: number | null;
    reconciliationDifference: number | null;
    paidTotal: number | null;
    pendingBalance: number | null;
  };
  completeness: {
    totalReliability:
      | "confirmed"
      | "last_reliable"
      | "estimated"
      | "unavailable";
    detailsCompleteness: "complete" | "partial" | "unavailable";
    unavailableSources: string[];
    warnings: string[];
  };
  synchronization: {
    lastCompleteSyncAt: string | null;
    lastAttemptAt: string | null;
    preservationReason: string | null;
    providerStatus: string | null;
  };
  counts: {
    movementCount: number;
    newPurchaseCount: number;
    postedInstallmentCount: number;
    projectedInstallmentCount: number;
    feeAndTaxCount: number;
    creditAndRefundCount: number;
  };
  movementsStatus: "success" | "partial" | "error";
  movements: CardCycleMovementDTO[];
  installments: CardCycleInstallmentDTO[];
  reconciliation: {
    status: "reconciled" | "partial" | "over_detailed" | "unavailable";
    explainedAmount: number | null;
    unexplainedAmount: number | null;
  };
  valueHistory: Array<{
    id: string;
    displayTotal: number;
    changeAmount: number;
    direction: "increase" | "decrease" | "unchanged";
    reason: string;
    source: string;
    createdAt: string;
  }>;
  cacheTag: string;
};

export type BuildResolvedCardCycleDetailsInput = {
  cycle: AvailableCardCycle;
  invoice: ResolvedOpenCardInvoice;
  purchases: CardPurchase[];
  installmentsDataStatus: InstallmentsDataStatus;
  movementCompleteness: "complete" | "partial" | "unavailable";
  unavailableSources: string[];
  warnings: string[];
  cardSource?: string | null;
  cardBrand?: string | null;
  confirmedOpenTotalSource?: string | null;
  paidAmount?: number | string | null;
  lastCompleteSyncAt?: string | null;
  lastAttemptAt?: string | null;
  preservationReason?: string | null;
  providerStatus?: string | null;
  valueHistory?: ResolvedCardCycleDetails["valueHistory"];
};

const money = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const nullableMoney = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? money(Math.abs(parsed)) : null;
};

const nullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.abs(parsed) : null;
};

function movementSource(value: string): CardCycleMovementDTO["source"] {
  if (value === "pdf") return "pdf";
  if (value === "manual") return "manual";
  if (value === "projection") return "projection";
  return "pluggy";
}

function totalSource(
  input: BuildResolvedCardCycleDetailsInput,
): ConfirmedCardCycleTotalSource {
  const source = input.invoice.displayTotalSource;
  if (source === "provider_bill") return "pluggy_current";
  if (source === "last_reliable") {
    return input.cardSource === "pluggy"
      ? "pluggy_last_reliable"
      : "manual";
  }
  if (source === "manual") return "manual";
  if (source === "calculated") return "calculated";
  if (source === "unavailable") return "unavailable";
  if (
    input.confirmedOpenTotalSource?.startsWith("manual") ||
    input.confirmedOpenTotalSource === "legacy_confirmed"
  ) return "manual";
  return input.cardSource === "pluggy"
    ? input.preservationReason
      ? "pluggy_last_reliable"
      : "pluggy_current"
    : "manual";
}

function toMovement(purchase: CardPurchase): CardCycleMovementDTO {
  const amountBrl = nullableMoney(purchase.amount_brl);
  const originalAmount = nullableMoney(purchase.original_amount);
  const originalCurrencyCode =
    purchase.original_currency_code ??
    (purchase.currency && purchase.currency !== "BRL"
      ? purchase.currency
      : null);
  const effect =
    purchase.transaction_role === "refund" ||
    Number(purchase.installment_amount) < 0
      ? "credit"
      : "debit";
  const entryType =
    purchase.entry_type ??
    (effect === "credit"
      ? "refund"
      : Number(purchase.installment_count ?? 0) > 1
        ? "installment_purchase"
        : "purchase");
  const classified = classifyOpenCardCycleMovement({
    id: purchase.id,
    amount: amountBrl ?? 0,
    effect,
    entryType,
    source: purchase.source,
    reconciliationStatus: purchase.reconciliation_status,
    installmentNumber: purchase.installment_number,
    installmentTotal: purchase.installment_count,
    description: purchase.description,
    cardId: purchase.card_id,
    competenceMonth: purchase.competence_month,
  });
  const source = movementSource(purchase.source);
  const reconciliationStatus = purchase.reconciliation_status ?? null;
  const conversionConfidence =
    purchase.conversion_confidence === null ||
    purchase.conversion_confidence === undefined
      ? null
      : Number(purchase.conversion_confidence);
  return {
    id: purchase.id,
    sourceRecordId: purchase.external_id ?? purchase.id,
    date: purchase.purchase_date,
    postingDate: purchase.posting_date ?? null,
    description: purchase.description,
    cardId: purchase.card_id,
    instrumentId: purchase.instrument_id ?? null,
    cardLabel:
      purchase.credit_card_instruments?.display_name ??
      purchase.credit_cards?.name ??
      "Cartão",
    entryType,
    classification: classified.classification,
    source,
    status: purchase.status,
    reconciliationStatus,
    reviewStatus: purchase.review_status,
    amountBrl,
    originalAmount,
    originalCurrencyCode,
    exchangeRate: nullableNumber(purchase.exchange_rate),
    foreignIofAmount: nullableMoney(purchase.foreign_iof_amount),
    conversionSource: purchase.conversion_source ?? null,
    conversionConfidence,
    installmentNumber: purchase.installment_number,
    installmentTotal: purchase.installment_count,
    effect,
    lowConfidence:
      amountBrl === null ||
      purchase.review_status === "pending" ||
      reconciliationStatus === "divergent" ||
      conversionConfidence !== null && conversionConfidence < 0.75,
  };
}

function installmentStatus(
  movement: CardCycleMovementDTO,
): CardCycleInstallmentDTO["status"] {
  if (movement.reconciliationStatus === "divergent") return "divergent";
  if (movement.source === "projection") return "projected";
  if (movement.reconciliationStatus === "matched") return "reconciled";
  return "posted";
}

export function buildResolvedCardCycleDetails(
  input: BuildResolvedCardCycleDetailsInput,
): ResolvedCardCycleDetails {
  const movements = input.purchases.map(toMovement);
  const breakdown = calculateOpenCardCycleBreakdown({
    movements: movements.map(movement => ({
      id: movement.id,
      amount: movement.amountBrl ?? 0,
      effect: movement.effect,
      entryType: movement.entryType,
      source: movement.source,
      reconciliationStatus: movement.reconciliationStatus,
      installmentNumber: movement.installmentNumber,
      installmentTotal: movement.installmentTotal,
      description: movement.description,
      cardId: movement.cardId,
    })),
    confirmedOpenTotal: null,
    installmentsDataStatus: input.installmentsDataStatus,
  });
  const hasMovementsWithoutBrl = movements.some(movement =>
    movement.amountBrl === null && movement.effect !== "credit");
  const unavailableSources = [...new Set(input.unavailableSources)];
  const detailsCompleteness =
    input.movementCompleteness === "unavailable"
      ? "unavailable"
      : input.movementCompleteness === "partial" ||
          input.installmentsDataStatus === "unavailable" ||
          hasMovementsWithoutBrl
        ? "partial"
        : "complete";
  const confirmedTotalSource = totalSource(input);
  const confirmedTotal =
    confirmedTotalSource === "calculated" ||
    confirmedTotalSource === "unavailable"
      ? null
      : nullableMoney(input.invoice.displayTotal);
  const detailedTotal =
    detailsCompleteness === "unavailable" ? null : breakdown.detailedTotal;
  const reconciliationDifference =
    confirmedTotal === null || detailedTotal === null
      ? null
      : money(confirmedTotal - detailedTotal);
  const paidTotal = nullableMoney(input.paidAmount) ?? 0;
  const pendingBalance =
    confirmedTotal === null ? null : money(Math.max(confirmedTotal - paidTotal, 0));
  const classificationCount = (
    ...classifications: OpenCardCycleEntryClassification[]
  ) => classifications.reduce(
    (total, classification) => total + breakdown.counts[classification],
    0,
  );
  const installments = movements
    .filter(movement =>
      movement.classification === "posted_installment" ||
      movement.classification === "projected_installment")
    .map(movement => ({
      id: `installment:${movement.id}`,
      movementId: movement.id,
      description: movement.description,
      cardLabel: movement.cardLabel,
      installmentNumber: movement.installmentNumber ?? 1,
      installmentTotal:
        movement.installmentTotal ?? movement.installmentNumber ?? 1,
      amountBrl: movement.amountBrl,
      source: movement.source,
      status: installmentStatus(movement),
      nextInstallments: Math.max(
        (movement.installmentTotal ?? 1) -
          (movement.installmentNumber ?? 1),
        0,
      ),
    }));
  const warnings = [...input.warnings];
  if (confirmedTotal !== null && detailsCompleteness !== "complete") {
    warnings.unshift(
      "O total da fatura foi recebido pela Pluggy, mas parte dos lançamentos ainda não foi disponibilizada pela instituição.",
    );
  }
  const cardLabels = [...new Set([
    input.cycle.cardLabel,
    ...movements.map(movement => movement.cardLabel),
  ].filter(Boolean))];
  const reconciliationStatus =
    reconciliationDifference === null
      ? "unavailable"
      : reconciliationDifference < -0.01
        ? "over_detailed"
        : Math.abs(reconciliationDifference) <= 0.01 &&
            detailsCompleteness === "complete"
          ? "reconciled"
          : "partial";
  return {
    cycle: {
      id: input.cycle.cycleId,
      status:
        input.invoice.status === "paid"
          ? "paid"
          : input.invoice.status === "overdue"
            ? "overdue"
            : input.invoice.status === "closed"
              ? "closed"
              : "open",
      cycleStartDate: input.cycle.cycleStartDate,
      cycleEndDate: input.cycle.cycleEndDate,
      closingDate: input.cycle.closingDate,
      dueDate: input.cycle.dueDate,
      referenceMonth: input.cycle.dueDate?.slice(0, 7) ?? null,
      cardAccountId: input.cycle.cardAccountId,
      cardIds: input.invoice.cardIds,
      cardLabels,
      cardName: input.invoice.cardName,
      cardBrand: input.cardBrand ?? null,
      cardLastFour: input.invoice.cardLastFour,
    },
    totals: {
      confirmedTotal,
      confirmedTotalSource,
      newPurchasesTotal: breakdown.newPurchasesTotal,
      postedInstallmentsTotal: breakdown.postedInstallmentsTotal,
      projectedInstallmentsTotal:
        input.installmentsDataStatus === "unavailable"
          ? null
          : breakdown.projectedUnpostedInstallmentsTotal,
      feesAndTaxesTotal: breakdown.feesAndTaxesTotal,
      creditsAndRefundsTotal: breakdown.creditsAndRefundsTotal,
      detailedTotal,
      reconciliationDifference,
      paidTotal,
      pendingBalance,
    },
    completeness: {
      totalReliability:
        confirmedTotalSource === "pluggy_last_reliable"
          ? "last_reliable"
          : ["pluggy_current", "pdf", "manual"].includes(confirmedTotalSource)
            ? "confirmed"
            : confirmedTotalSource === "calculated"
              ? "estimated"
              : "unavailable",
      detailsCompleteness,
      unavailableSources,
      warnings: [...new Set(warnings)],
    },
    synchronization: {
      lastCompleteSyncAt: input.lastCompleteSyncAt ?? null,
      lastAttemptAt: input.lastAttemptAt ?? null,
      preservationReason: input.preservationReason ?? null,
      providerStatus: input.providerStatus ?? null,
    },
    counts: {
      movementCount: movements.length,
      newPurchaseCount: classificationCount("new_purchase"),
      postedInstallmentCount: classificationCount("posted_installment"),
      projectedInstallmentCount: classificationCount("projected_installment"),
      feeAndTaxCount: classificationCount("fee", "tax", "adjustment"),
      creditAndRefundCount: classificationCount("credit", "refund"),
    },
    movementsStatus:
      input.movementCompleteness === "unavailable"
        ? "error"
        : detailsCompleteness === "partial"
          ? "partial"
          : "success",
    movements,
    installments,
    reconciliation: {
      status: reconciliationStatus,
      explainedAmount: detailedTotal,
      unexplainedAmount: reconciliationDifference,
    },
    valueHistory: input.valueHistory ?? [],
    cacheTag: input.invoice.cacheTag,
  };
}
