import {
  invoiceReviewSchema,
} from "./validation";
import type {
  InvoiceReviewState,
  ParsedInvoiceEntry,
} from "./types";
import type {
  ExistingInvoiceDocumentResolution,
  InvoiceDocumentStateRow,
} from "./existing-document";

export type InvoiceImportStep = "document" | "processing" | "review" | "confirmation";
export type InvoiceImportStepVisualState = "completed" | "current" | "upcoming";

export type InvoiceImportReviewDTO = {
  document: {
    id: string;
    filename: string;
    processingStatus: string;
    reviewStatus: string;
    parserName: string | null;
    parserVersion: string | null;
    confidence: number;
    createdAt: string;
    processedAt: string | null;
    pageCount: number;
  };
  invoice: {
    bankName: string | null;
    cardId: string;
    cardLastFour: string | null;
    cycleStartDate: string | null;
    cycleEndDate: string | null;
    closingDate: string | null;
    dueDate: string | null;
    officialTotalCents: number | null;
    minimumPaymentCents: number | null;
    previousBalanceCents: number | null;
    paymentsTotalCents: number;
    creditsTotalCents: number;
    domesticDebitsTotalCents: number | null;
    foreignDebitsTotalCents: number | null;
    reconstructedTotalCents: number;
    reconciliationDifferenceCents: number | null;
    futureInstallmentBalanceCents: number | null;
  } | null;
  cardSections: NonNullable<InvoiceReviewState["parsed"]["cardSections"]>;
  entries: ParsedInvoiceEntry[];
  installments: Array<{
    entryId: string;
    merchant: string;
    cardLastFour: string | null;
    installmentAmountCents: number;
    currentInstallment: number;
    totalInstallments: number;
    remainingInstallments: number;
    confidence: number;
  }>;
  warnings: string[];
  validation: InvoiceReviewState["parsed"]["validation"] | null;
  permissions: {
    canReview: boolean;
    canReprocess: boolean;
    canReplace: boolean;
    canDelete: boolean;
    canConfirm: boolean;
  };
  inconsistent: boolean;
  reviewState: InvoiceReviewState | null;
  resolution: ExistingInvoiceDocumentResolution;
};

type ReviewDocumentRow = InvoiceDocumentStateRow & {
  original_filename: string;
  parser_name?: string | null;
  parser_version?: string | null;
  confidence?: number | string | null;
  parsed_payload?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

const stepOrder: InvoiceImportStep[] = [
  "document",
  "processing",
  "review",
  "confirmation",
];

export function getInvoiceImportStepState(status: string) {
  const current: InvoiceImportStep =
    status === "confirmed"
      ? "confirmation"
      : status === "needs_review" || status === "parsed"
        ? "review"
        : ["extracting", "extracted", "parsing", "failed", "processing_failed"].includes(status)
          ? "processing"
          : "document";
  const currentIndex = stepOrder.indexOf(current);
  return Object.fromEntries(
    stepOrder.map((step, index) => [
      step,
      index < currentIndex
        ? "completed"
        : index === currentIndex
          ? "current"
          : "upcoming",
    ]),
  ) as Record<InvoiceImportStep, InvoiceImportStepVisualState>;
}

export function parseStoredInvoiceReview(payload: unknown) {
  const parsed = invoiceReviewSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

export function toSerializableValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    return Object.fromEntries(
      [...value.entries()].map(([key, item]) => [
        String(key),
        toSerializableValue(item),
      ]),
    );
  }
  if (value instanceof Set) {
    return [...value].map(toSerializableValue);
  }
  if (Array.isArray(value)) return value.map(toSerializableValue);
  if (typeof value === "object") {
    if (
      value.constructor?.name === "Decimal" &&
      "toString" in value &&
      typeof value.toString === "function"
    ) {
      return value.toString();
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        toSerializableValue(item),
      ]),
    );
  }
  return value;
}

export function buildInvoiceImportReviewDTO(
  row: ReviewDocumentRow,
  resolution: ExistingInvoiceDocumentResolution,
): InvoiceImportReviewDTO {
  const review = parseStoredInvoiceReview(row.parsed_payload);
  const entries = review?.parsed.entries ?? [];
  const warnings = review?.parsed.warnings ?? [];
  const installments = entries
    .filter(entry => !entry.isIgnored && entry.installment)
    .map(entry => ({
      entryId: entry.id,
      merchant: entry.merchantNormalized || entry.descriptionRaw,
      cardLastFour: entry.cardLastFour,
      installmentAmountCents: Math.abs(entry.amountCents),
      currentInstallment: entry.installment!.current,
      totalInstallments: entry.installment!.total,
      remainingInstallments:
        entry.installment!.total - entry.installment!.current,
      confidence: entry.installment!.confidence,
    }));
  const inconsistent =
    ["needs_review", "parsed"].includes(row.processing_status) && !review;
  const parsed = review?.parsed;
  const reconciliation = review?.reconciliation;

  return {
    document: {
      id: row.id,
      filename: row.original_filename,
      processingStatus: row.processing_status,
      reviewStatus: row.review_status,
      parserName: row.parser_name ?? null,
      parserVersion: row.parser_version ?? null,
      confidence: Number(row.confidence ?? parsed?.confidence ?? 0),
      createdAt: row.created_at ?? "",
      processedAt:
        ["needs_review", "parsed", "confirmed"].includes(row.processing_status)
          ? row.updated_at ?? null
          : null,
      pageCount: parsed?.pageCount ?? 0,
    },
    invoice: review
      ? {
          bankName: parsed!.bankName,
          cardId: review.cardId,
          cardLastFour: parsed!.cardLastFour,
          cycleStartDate: parsed!.cycleStartDate,
          cycleEndDate: parsed!.cycleEndDate,
          closingDate: parsed!.closingDate,
          dueDate: parsed!.dueDate,
          officialTotalCents: parsed!.officialTotalCents,
          minimumPaymentCents: parsed!.minimumPaymentCents ?? null,
          previousBalanceCents: parsed!.previousBalanceCents,
          paymentsTotalCents: reconciliation!.paymentsCents,
          creditsTotalCents: reconciliation!.creditsCents,
          domesticDebitsTotalCents:
            parsed!.santanderSummary?.domesticDebitsCents ?? null,
          foreignDebitsTotalCents:
            parsed!.santanderSummary?.foreignDebitsCents ?? null,
          reconstructedTotalCents: reconciliation!.reconstructedTotalCents,
          reconciliationDifferenceCents: reconciliation!.differenceCents,
          futureInstallmentBalanceCents:
            parsed!.providerFutureInstallmentBalanceCents ?? null,
        }
      : null,
    cardSections: parsed?.cardSections ?? [],
    entries,
    installments,
    warnings,
    validation: parsed?.validation ?? null,
    permissions: {
      canReview: Boolean(review) && !inconsistent,
      canReprocess: resolution.documentStatus !== "confirmed",
      canReplace: resolution.canReplace,
      canDelete: resolution.canDelete,
      canConfirm:
        Boolean(review?.parsed.dueDate) &&
        review?.parsed.officialTotalCents !== null &&
        !inconsistent,
    },
    inconsistent,
    reviewState: review,
    resolution,
  };
}
