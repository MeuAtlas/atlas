export type OpenCardCycleEntryClassification =
  | "new_purchase"
  | "posted_installment"
  | "projected_installment"
  | "credit"
  | "refund"
  | "fee"
  | "tax"
  | "adjustment";

export type InstallmentsDataStatus =
  | "available"
  | "partial"
  | "unavailable"
  | "confirmed_zero";

export type OpenCardCycleBreakdown = {
  newPurchasesTotal: number;
  postedInstallmentsTotal: number;
  projectedUnpostedInstallmentsTotal: number;
  feesAndTaxesTotal: number;
  creditsAndRefundsTotal: number;
  detailedTotal: number;
  confirmedOpenTotal: number | null;
  reconciliationDifference: number | null;
};

export type OpenCardCycleMovementInput = {
  id: string;
  amount: number;
  effect: "debit" | "credit";
  entryType?: string | null;
  source?: string | null;
  reconciliationStatus?: string | null;
  installmentNumber?: number | null;
  installmentTotal?: number | null;
  description?: string | null;
  merchantNormalized?: string | null;
  cardId?: string | null;
  cardLastFour?: string | null;
  competenceMonth?: string | null;
  currencyCode?: string | null;
};

export type ClassifiedOpenCardCycleMovement =
  OpenCardCycleMovementInput & {
    classification: OpenCardCycleEntryClassification;
  };

export type PreviousInvoiceInstallment = {
  sourceId: string;
  merchantNormalized: string;
  description: string;
  amount: number;
  currencyCode: string;
  cardId: string;
  cardLastFour: string | null;
  originalDate: string | null;
  currentInstallment: number;
  totalInstallments: number;
  confidence: number;
};

export type InstallmentOccurrenceSeed = {
  sourceId: string;
  matchingFingerprint: string;
  merchantNormalized: string;
  description: string;
  amount: number;
  currencyCode: string;
  cardId: string;
  cardLastFour: string | null;
  originalDate: string | null;
  installmentNumber: number;
  totalInstallments: number;
  competenceMonth: string;
  dueDate: string;
  status: "projected" | "posted";
  confidence: number;
};

export type InstallmentMatchResult = {
  status:
    | "exact_match"
    | "high_confidence_match"
    | "review_required"
    | "no_match"
    | "divergent";
  score: number;
  reasons: string[];
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const monthStart = (value: string) => `${value.slice(0, 7)}-01`;

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1))
    .toISOString().slice(0, 10);
}

function dueDateForMonth(competenceMonth: string, dueDay: number) {
  const [year, month] = competenceMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${competenceMonth.slice(0, 8)}${String(Math.min(dueDay, lastDay)).padStart(2, "0")}`;
}

export function normalizeInstallmentMerchant(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Z0-9]+/gi, " ")
    .trim()
    .toUpperCase();
}

export function buildInstallmentPlanFingerprint(input: {
  cardId: string;
  cardLastFour: string | null;
  merchantNormalized: string;
  originalDate: string | null;
  totalInstallments: number;
  currencyCode: string;
  estimatedFirstCompetence: string;
}) {
  return [
    "atlas:installment:v2",
    input.cardId,
    input.cardLastFour ?? "",
    normalizeInstallmentMerchant(input.merchantNormalized),
    input.originalDate ?? monthStart(input.estimatedFirstCompetence),
    input.totalInstallments,
    input.currencyCode || "BRL",
  ].join("|");
}

export function classifyOpenCardCycleMovement(
  movement: OpenCardCycleMovementInput,
): ClassifiedOpenCardCycleMovement {
  const entryType = movement.entryType ?? "";
  const normalizedDescription = normalizeInstallmentMerchant(
    movement.description,
  );
  const isTaxByDescription = /\bIOF\b/.test(normalizedDescription);
  const isFeeByDescription =
    /\b(ANUIDADE|ENCARGO|JUROS|TARIFA)\b/.test(normalizedDescription);
  let classification: OpenCardCycleEntryClassification;
  if (movement.effect === "credit") {
    classification = entryType === "refund" ? "refund" : "credit";
  } else if (entryType === "tax" || isTaxByDescription) {
    classification = "tax";
  } else if (["fee", "interest"].includes(entryType) || isFeeByDescription) {
    classification = "fee";
  } else if (entryType === "adjustment") {
    classification = "adjustment";
  } else if (
    movement.source === "projection" ||
    movement.reconciliationStatus === "projected_only"
  ) {
    classification = "projected_installment";
  } else if (
    entryType === "installment_purchase" ||
    Number(movement.installmentTotal ?? 0) > 1
  ) {
    classification = "posted_installment";
  } else {
    classification = "new_purchase";
  }
  return { ...movement, classification };
}

export function calculateOpenCardCycleBreakdown(input: {
  movements: OpenCardCycleMovementInput[];
  confirmedOpenTotal: number | null;
  installmentsDataStatus: InstallmentsDataStatus;
}): OpenCardCycleBreakdown & {
  classified: ClassifiedOpenCardCycleMovement[];
  counts: Record<OpenCardCycleEntryClassification, number>;
  installmentsDataStatus: InstallmentsDataStatus;
} {
  const classified = input.movements.map(classifyOpenCardCycleMovement);
  const totals: Record<OpenCardCycleEntryClassification, number> = {
    new_purchase: 0,
    posted_installment: 0,
    projected_installment: 0,
    credit: 0,
    refund: 0,
    fee: 0,
    tax: 0,
    adjustment: 0,
  };
  const counts = Object.fromEntries(
    Object.keys(totals).map(key => [key, 0]),
  ) as Record<OpenCardCycleEntryClassification, number>;
  for (const movement of classified) {
    totals[movement.classification] += Math.abs(movement.amount);
    counts[movement.classification] += 1;
  }
  const newPurchasesTotal = roundMoney(totals.new_purchase);
  const postedInstallmentsTotal = roundMoney(totals.posted_installment);
  const projectedUnpostedInstallmentsTotal =
    roundMoney(totals.projected_installment);
  const feesAndTaxesTotal =
    roundMoney(totals.fee + totals.tax + totals.adjustment);
  const creditsAndRefundsTotal =
    roundMoney(totals.credit + totals.refund);
  const detailedTotal = roundMoney(
    newPurchasesTotal +
    postedInstallmentsTotal +
    projectedUnpostedInstallmentsTotal +
    feesAndTaxesTotal -
    creditsAndRefundsTotal,
  );
  const confirmedOpenTotal = input.confirmedOpenTotal === null
    ? null
    : roundMoney(input.confirmedOpenTotal);
  const reconciliationDifference =
    confirmedOpenTotal === null ||
    input.installmentsDataStatus === "unavailable"
      ? null
      : roundMoney(confirmedOpenTotal - detailedTotal);
  return {
    newPurchasesTotal,
    postedInstallmentsTotal,
    projectedUnpostedInstallmentsTotal,
    feesAndTaxesTotal,
    creditsAndRefundsTotal,
    detailedTotal,
    confirmedOpenTotal,
    reconciliationDifference,
    classified,
    counts,
    installmentsDataStatus: input.installmentsDataStatus,
  };
}

export function buildNextInstallmentOccurrence(
  installment: PreviousInvoiceInstallment,
  targetCompetenceMonth: string,
  dueDay: number,
): InstallmentOccurrenceSeed | null {
  const installmentNumber = installment.currentInstallment + 1;
  if (
    installment.currentInstallment < 1 ||
    installment.totalInstallments < installmentNumber ||
    installment.amount <= 0
  ) {
    return null;
  }
  const competenceMonth = monthStart(targetCompetenceMonth);
  const estimatedFirstCompetence = shiftMonth(
    competenceMonth,
    -(installmentNumber - 1),
  );
  return {
    sourceId: installment.sourceId,
    matchingFingerprint: buildInstallmentPlanFingerprint({
      ...installment,
      estimatedFirstCompetence,
    }),
    merchantNormalized: normalizeInstallmentMerchant(
      installment.merchantNormalized || installment.description,
    ),
    description: installment.description,
    amount: roundMoney(installment.amount),
    currencyCode: installment.currencyCode || "BRL",
    cardId: installment.cardId,
    cardLastFour: installment.cardLastFour,
    originalDate: installment.originalDate,
    installmentNumber,
    totalInstallments: installment.totalInstallments,
    competenceMonth,
    dueDate: dueDateForMonth(competenceMonth, dueDay),
    status: "projected",
    confidence: installment.confidence,
  };
}

export function buildPostedInstallmentOccurrence(
  installment: PreviousInvoiceInstallment,
  competenceMonthValue: string,
  dueDay: number,
): InstallmentOccurrenceSeed | null {
  if (
    installment.currentInstallment < 1 ||
    installment.currentInstallment > installment.totalInstallments ||
    installment.amount <= 0
  ) {
    return null;
  }
  const competenceMonth = monthStart(competenceMonthValue);
  const estimatedFirstCompetence = shiftMonth(
    competenceMonth,
    -(installment.currentInstallment - 1),
  );
  return {
    sourceId: installment.sourceId,
    matchingFingerprint: buildInstallmentPlanFingerprint({
      ...installment,
      estimatedFirstCompetence,
    }),
    merchantNormalized: normalizeInstallmentMerchant(
      installment.merchantNormalized || installment.description,
    ),
    description: installment.description,
    amount: roundMoney(installment.amount),
    currencyCode: installment.currencyCode || "BRL",
    cardId: installment.cardId,
    cardLastFour: installment.cardLastFour,
    originalDate: installment.originalDate,
    installmentNumber: installment.currentInstallment,
    totalInstallments: installment.totalInstallments,
    competenceMonth,
    dueDate: dueDateForMonth(competenceMonth, dueDay),
    status: "posted",
    confidence: installment.confidence,
  };
}

export function projectInstallmentSeed(
  first: InstallmentOccurrenceSeed,
  dueDay: number,
): InstallmentOccurrenceSeed[] {
  const result: InstallmentOccurrenceSeed[] = [];
  for (
    let number = first.installmentNumber;
    number <= first.totalInstallments;
    number += 1
  ) {
    const competenceMonth = shiftMonth(
      first.competenceMonth,
      number - first.installmentNumber,
    );
    result.push({
      ...first,
      installmentNumber: number,
      competenceMonth,
      dueDate: dueDateForMonth(competenceMonth, dueDay),
      status: number === first.installmentNumber
        ? first.status
        : "projected",
    });
  }
  return result;
}

export function matchInstallmentTransactionToOccurrence(
  transaction: OpenCardCycleMovementInput,
  occurrence: InstallmentOccurrenceSeed,
): InstallmentMatchResult {
  const reasons: string[] = [];
  let score = 0;
  const amountMatches =
    Math.abs(Math.abs(transaction.amount) - occurrence.amount) <= 0.01;
  if (amountMatches) score += 35;
  else reasons.push("amount");
  const transactionMerchant = normalizeInstallmentMerchant(
    transaction.merchantNormalized || transaction.description,
  );
  const merchantMatches =
    transactionMerchant === occurrence.merchantNormalized ||
    (
      Math.min(transactionMerchant.length, occurrence.merchantNormalized.length) >= 6 &&
      (
        transactionMerchant.includes(occurrence.merchantNormalized) ||
        occurrence.merchantNormalized.includes(transactionMerchant)
      )
    );
  if (merchantMatches) score += 25;
  else reasons.push("merchant");
  const cardMatches =
    !transaction.cardLastFour ||
    !occurrence.cardLastFour ||
    transaction.cardLastFour === occurrence.cardLastFour;
  if (cardMatches) score += 15;
  else reasons.push("card");
  const installmentMatches =
    transaction.installmentNumber === occurrence.installmentNumber &&
    transaction.installmentTotal === occurrence.totalInstallments;
  if (installmentMatches) score += 15;
  else reasons.push("installment");
  const competenceMatches =
    !transaction.competenceMonth ||
    monthStart(transaction.competenceMonth) === occurrence.competenceMonth;
  if (competenceMatches) score += 10;
  else reasons.push("competence");

  if (!amountMatches || !cardMatches) {
    return { status: "divergent", score, reasons };
  }
  if (score === 100) return { status: "exact_match", score, reasons };
  if (score >= 75) {
    return { status: "high_confidence_match", score, reasons };
  }
  if (score >= 60) return { status: "review_required", score, reasons };
  return { status: "no_match", score, reasons };
}
