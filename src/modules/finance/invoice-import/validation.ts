import { z } from "zod";
import type { ParsedInvoiceEntry } from "./types";

export function invoiceDueDateMatchesReferenceMonth(
  dueDate: string | null | undefined,
  referenceMonth: string,
) {
  return Boolean(
    dueDate && `${dueDate.slice(0, 7)}-01` === referenceMonth,
  );
}

export function invoicePeriodMatchesReferenceMonth(
  invoice: {
    closingDate?: string | null;
    cycleEndDate?: string | null;
    dueDate?: string | null;
  },
  referenceMonth: string,
) {
  const referenceDate = invoice.closingDate ?? invoice.cycleEndDate ?? invoice.dueDate;
  return Boolean(
    referenceDate && `${referenceDate.slice(0, 7)}-01` === referenceMonth,
  );
}

export function normalizeInvoiceEntryInstallments(
  entries: ParsedInvoiceEntry[],
): ParsedInvoiceEntry[] {
  return entries.map(entry =>
    entry.entryType === "installment_purchase" && entry.installment === null
      ? { ...entry, entryType: "purchase" }
      : entry,
  );
}

const installmentSchema = z.object({
  current: z.number().int().min(1).max(120),
  total: z.number().int().min(2).max(120),
  raw: z.string().max(80),
  confidence: z.number().min(0).max(1),
}).refine(value => value.total >= value.current);

const entrySchema = z.object({
  id: z.string().uuid(),
  transactionDate: z.string().date().nullable(),
  postingDate: z.string().date().nullable(),
  descriptionRaw: z.string().trim().min(1).max(500),
  descriptionNormalized: z.string().max(500),
  merchantNormalized: z.string().max(300),
  amountCents: z.number().int().min(-99999999999).max(99999999999),
  currencyCode: z.string().length(3),
  entryType: z.enum(["purchase","installment_purchase","credit","refund","payment","fee","interest","tax","previous_balance","adjustment","unknown"]),
  cardLastFour: z.string().regex(/^\d{4}$/).nullable(),
  installment: installmentSchema.nullable(),
  confidence: z.number().min(0).max(1),
  reviewStatus: z.enum(["pending","approved","edited","ignored"]),
  isIgnored: z.boolean(),
  sourceLineNumber: z.number().int().positive().nullable(),
  foreignAmountCents: z.number().int().nullable().optional(),
  foreignCurrencyCode: z.string().length(3).nullable().optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  iofAmountCents: z.number().int().positive().nullable().optional(),
  relatedForeignEntryId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

const cardSectionSchema = z.object({
  cardLastFour: z.string().regex(/^\d{4}$/).nullable(),
  holderName: z.string().max(200).nullable(),
  subtotalBRLCents: z.number().int().nullable(),
  subtotalForeignCents: z.number().int().nullable(),
  entriesCount: z.number().int().nonnegative(),
  installmentCount: z.number().int().nonnegative(),
});

const santanderSummarySchema = z.object({
  previousBalanceCents: z.number().int().nullable(),
  domesticDebitsCents: z.number().int().nullable(),
  foreignDebitsCents: z.number().int().nullable(),
  paymentsCents: z.number().int().nullable(),
  creditsCents: z.number().int().nullable(),
  finalBalanceCents: z.number().int().nullable(),
});

const validationResultSchema = z.object({
  officialTotalMatchesSummary: z.boolean(),
  cardSubtotalsMatchOfficialTotal: z.boolean(),
  reconstructedEntriesMatchSubtotals: z.boolean(),
  futureProjectionMatchesProviderBalance: z.boolean().nullable(),
  summaryDifferenceCents: z.number().int(),
  cardSubtotalDifferenceCents: z.number().int(),
  entryDifferenceCents: z.number().int(),
  futureProjectionDifferenceCents: z.number().int().nullable(),
});

export const invoiceReviewSchema = z.object({
  documentId: z.string().uuid(),
  originalFilename: z.string().min(1).max(180),
  cardId: z.string().uuid(),
  cardName: z.string().min(1).max(200),
  parsed: z.object({
    bankCode: z.string().nullable(),
    bankName: z.string().nullable(),
    parserName: z.string(),
    parserVersion: z.string(),
    cardLastFour: z.string().regex(/^\d{4}$/).nullable(),
    cycleStartDate: z.string().date().nullable(),
    cycleEndDate: z.string().date().nullable(),
    closingDate: z.string().date().nullable(),
    dueDate: z.string().date().nullable(),
    officialTotalCents: z.number().int().min(0).nullable(),
    previousBalanceCents: z.number().int().nullable(),
    currencyCode: z.string().length(3),
    entries: z.array(entrySchema).max(5000),
    confidence: z.number().min(0).max(1),
    fieldConfidence: z.record(z.string(), z.number().min(0).max(1)),
    warnings: z.array(z.string().max(500)),
    pageCount: z.number().int().positive().max(1000),
    minimumPaymentCents: z.number().int().nullable().optional(),
    nextOpenInvoiceAmountCents: z.number().int().nullable().optional(),
    nextCycleStartDate: z.string().date().nullable().optional(),
    nextCycleEndDate: z.string().date().nullable().optional(),
    providerFutureInstallmentBalanceCents: z.number().int().nullable().optional(),
    cardSections: z.array(cardSectionSchema).optional(),
    santanderSummary: santanderSummarySchema.nullable().optional(),
    validation: validationResultSchema.nullable().optional(),
  }),
  reconciliation: z.object({
    officialTotalCents: z.number().int().nullable(),
    purchasesCents: z.number().int(),
    creditsCents: z.number().int(),
    paymentsCents: z.number().int(),
    financeChargesCents: z.number().int(),
    previousBalanceCents: z.number().int(),
    reconstructedTotalCents: z.number().int(),
    differenceCents: z.number().int().nullable(),
    status: z.enum(["matched","different","unavailable"]),
  }),
  statementComparison: z.object({
    statementId: z.string().uuid(),
    pluggyBillTotalCents: z.number().int().min(0).nullable(),
    pdfTotalCents: z.number().int().min(0).nullable(),
    selectedTotalSource: z.enum(["statement_pdf", "pluggy_bill"]),
  }).optional(),
});
