export type OpenInvoiceDisplayTotalSource =
  | "confirmed_open_total"
  | "provider_bill"
  | "manual"
  | "calculated"
  | "last_reliable"
  | "unavailable";

export type OpenInvoiceDataCompleteness =
  | "complete"
  | "partial"
  | "unavailable";

export type ResolvedOpenCardInvoice = {
  cycleId: string;
  cardAccountId: string;
  cardIds: string[];
  cardName: string;
  cardLastFour: string | null;
  cycleStartDate: string;
  cycleEndDate: string;
  closingDate: string | null;
  dueDate: string | null;
  status: "open" | "closed" | "paid" | "overdue";
  confirmedOpenTotal: number | null;
  detailedTotal: number | null;
  newPurchasesTotal: number | null;
  postedInstallmentsTotal: number | null;
  projectedInstallmentsTotal: number | null;
  feesAndTaxesTotal: number | null;
  creditsAndRefundsTotal: number | null;
  reconciliationDifference: number | null;
  displayTotal: number | null;
  displayTotalSource: OpenInvoiceDisplayTotalSource;
  dataCompleteness: OpenInvoiceDataCompleteness;
  totalReliability: "confirmed" | "reliable" | "estimated" | "unavailable";
  detailsCompleteness: OpenInvoiceDataCompleteness;
  updatedAt: string | null;
  confirmedAt: string | null;
  sourceLabel: string;
  snapshotCount: number;
  cacheTag: string;
};

export type OpenInvoiceTotalAliases = {
  confirmedOpenTotal?: unknown;
  confirmedOpenTotalAt?: string | null;
  confirmationTotal?: unknown;
  confirmationAt?: string | null;
  legacyConfirmedTotal?: unknown;
  providerInvoiceTotal?: unknown;
  providerReliable?: boolean;
  providerUpdatedAt?: string | null;
  manualInvoiceTotal?: unknown;
  manualUpdatedAt?: string | null;
  calculatedTotal?: unknown;
  calculatedReliable?: boolean;
  calculatedUpdatedAt?: string | null;
  lastReliableTotal?: unknown;
  lastReliableUpdatedAt?: string | null;
  persistedDisplayTotal?: unknown;
  persistedDataCompleteness?: "complete" | "partial" | "unknown" | null;
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function openInvoiceMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0
    ? roundMoney(Math.abs(number))
    : null;
}

export function openInvoiceCacheTag(
  workspaceId: string | null | undefined,
  cycleId: string,
) {
  return cardCycleDetailsCacheTag(workspaceId, cycleId);
}

export function cardCycleDetailsCacheTag(
  workspaceId: string | null | undefined,
  cycleId: string,
) {
  return `finance:card-cycle-details:${workspaceId ?? "personal"}:${cycleId}`;
}

export function resolveOpenInvoiceTotal(input: OpenInvoiceTotalAliases) {
  const confirmedOpen = openInvoiceMoney(input.confirmedOpenTotal);
  const confirmation = openInvoiceMoney(input.confirmationTotal);
  const legacyConfirmed = openInvoiceMoney(input.legacyConfirmedTotal);
  const provider = openInvoiceMoney(input.providerInvoiceTotal);
  const manual = openInvoiceMoney(input.manualInvoiceTotal);
  const calculated = openInvoiceMoney(input.calculatedTotal);
  const lastReliable = openInvoiceMoney(input.lastReliableTotal);
  const persistedDisplay = openInvoiceMoney(input.persistedDisplayTotal);
  const providerCandidate = {
    amount: provider,
    source: "provider_bill" as const,
    reliable: input.providerReliable === true,
    updatedAt: input.providerUpdatedAt ?? null,
  };
  const partialBaseline = input.persistedDataCompleteness === "partial"
    ? [persistedDisplay, lastReliable]
        .filter((amount): amount is number => amount !== null)
        .reduce<number | null>((highest, amount) =>
          highest === null ? amount : Math.max(highest, amount), null)
    : null;
  if (providerCandidate.amount !== null && providerCandidate.reliable) {
    if (
      partialBaseline !== null &&
      providerCandidate.amount < partialBaseline
    ) {
      return {
        amount: partialBaseline,
        source: "last_reliable" as const,
        reliable: true,
        updatedAt: input.lastReliableUpdatedAt ?? input.calculatedUpdatedAt ?? null,
      };
    }
    return providerCandidate;
  }

  const manuallyConfirmedCandidates: Array<{
    amount: number | null;
    source: OpenInvoiceDisplayTotalSource;
    reliable: boolean;
    updatedAt: string | null;
  }> = [
    {
      amount: confirmedOpen,
      source: "confirmed_open_total",
      reliable: true,
      updatedAt: input.confirmedOpenTotalAt ?? null,
    },
    {
      amount: confirmation,
      source: "confirmed_open_total",
      reliable: true,
      updatedAt: input.confirmationAt ?? null,
    },
    {
      amount: legacyConfirmed,
      source: "confirmed_open_total",
      reliable: true,
      updatedAt: input.manualUpdatedAt ?? null,
    },
    {
      amount: manual,
      source: "manual",
      reliable: true,
      updatedAt: input.manualUpdatedAt ?? null,
    },
  ];
  const manuallyConfirmed = manuallyConfirmedCandidates.find(candidate =>
    candidate.amount !== null && candidate.reliable);
  const estimate = {
    amount: calculated,
    source: "calculated" as const,
    reliable: input.calculatedReliable !== false,
    updatedAt: input.calculatedUpdatedAt ?? null,
  };
  if (
    manuallyConfirmed?.amount !== null &&
    manuallyConfirmed?.amount !== undefined &&
    estimate.amount !== null &&
    estimate.reliable
  ) {
    return estimate.amount > manuallyConfirmed.amount
      ? estimate
      : manuallyConfirmed;
  }
  if (
    input.persistedDataCompleteness === "partial" &&
    persistedDisplay !== null
  ) {
    return {
      amount: persistedDisplay,
      source: lastReliable !== null && persistedDisplay <= lastReliable
        ? "last_reliable" as const
        : "calculated" as const,
      reliable: lastReliable !== null && persistedDisplay <= lastReliable,
      updatedAt: input.calculatedUpdatedAt ?? input.lastReliableUpdatedAt ?? null,
    };
  }
  if (
    manuallyConfirmed?.amount !== null &&
    manuallyConfirmed?.amount !== undefined
  ) {
    return manuallyConfirmed;
  }
  if (lastReliable !== null) {
    return {
      amount: lastReliable,
      source: "last_reliable" as const,
      reliable: true,
      updatedAt: input.lastReliableUpdatedAt ?? null,
    };
  }
  if (estimate.amount !== null && estimate.reliable) return estimate;
  return {
    amount: null,
    source: "unavailable" as const,
    reliable: false,
    updatedAt: null,
  };
}

export function resolvedOpenInvoiceSourceLabel(input: {
  source: OpenInvoiceDisplayTotalSource;
  institutionName?: string | null;
  providerOrigin?: boolean;
}) {
  if (input.source === "confirmed_open_total") {
    if (input.providerOrigin) return "Pluggy";
    return /santander/i.test(input.institutionName ?? "")
      ? "Confirmada no Santander"
      : "Confirmada manualmente";
  }
  if (input.source === "provider_bill") return "Valor informado pelo banco";
  if (input.source === "manual") return "Atualizada manualmente";
  if (input.source === "calculated") {
    return "Calculado pelas compras sincronizadas";
  }
  if (input.source === "last_reliable") {
    return input.providerOrigin
      ? "Pluggy — último valor confiável"
      : "Último valor confiável";
  }
  return "Valor indisponível";
}

export function openInvoiceDifference(
  confirmedTotal: number | null,
  detailedTotal: number | null,
) {
  if (confirmedTotal === null || detailedTotal === null) return null;
  return roundMoney(confirmedTotal - detailedTotal);
}
