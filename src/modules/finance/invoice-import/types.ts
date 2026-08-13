export type InvoiceEntryType =
  | "purchase" | "installment_purchase" | "credit" | "refund" | "payment"
  | "fee" | "interest" | "tax" | "previous_balance" | "adjustment" | "unknown";

export type ConfidenceLevel = "high" | "medium" | "low";

export interface PdfTextItem {
  pageNumber: number;
  index?: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL?: boolean;
  visualIndex: number;
  rawX?: number;
  rawY?: number;
}

export interface PdfVisualLine {
  pageNumber: number;
  columnIndex: number;
  x: number;
  y: number;
  text: string;
  items: PdfTextItem[];
}

export interface ExtractedPdfPage {
  pageNumber: number;
  width: number;
  height: number;
  text: string;
  plainText?: string;
  lines: string[];
  items: PdfTextItem[];
  visualLines: PdfVisualLine[];
}

export interface ExtractedPdfDocument {
  pageCount: number;
  pages: ExtractedPdfPage[];
  fullText: string;
  itemCount?: number;
  characterCount?: number;
  metadata: Record<string, string>;
  extractionWarnings: string[];
  warnings?: string[];
  extractionMethod:
    | "text_layer"
    | "pdfjs_text_layer"
    | "pdfjs_legacy"
    | "linear_fallback"
    | "image_only";
  extractorVersion?: string;
  quality?: {
    characterCount: number;
    nonWhitespaceCharacterCount: number;
    pagesWithText: number;
    knownMarkersFound: string[];
    markersFound?: string[];
    confidence: number;
    likelyImageOnly: boolean;
  };
}

export interface ParsedInstallment {
  current: number;
  total: number;
  raw: string;
  confidence: number;
}

export interface ParsedInvoiceEntry {
  id: string;
  transactionDate: string | null;
  postingDate: string | null;
  descriptionRaw: string;
  descriptionNormalized: string;
  merchantNormalized: string;
  amountCents: number;
  currencyCode: string;
  entryType: InvoiceEntryType;
  cardLastFour: string | null;
  installment: ParsedInstallment | null;
  confidence: number;
  reviewStatus: "pending" | "approved" | "edited" | "ignored";
  isIgnored: boolean;
  sourceLineNumber: number | null;
  foreignAmountCents?: number | null;
  foreignCurrencyCode?: string | null;
  exchangeRate?: number | null;
  iofAmountCents?: number | null;
  relatedForeignEntryId?: string | null;
  note?: string | null;
}

export interface ParsedCardSection {
  cardLastFour: string | null;
  holderName: string | null;
  subtotalBRLCents: number | null;
  subtotalForeignCents: number | null;
  entriesCount: number;
  installmentCount: number;
}

export interface SantanderInvoiceSummary {
  previousBalanceCents: number | null;
  domesticDebitsCents: number | null;
  foreignDebitsCents: number | null;
  paymentsCents: number | null;
  creditsCents: number | null;
  finalBalanceCents: number | null;
}

export interface InvoiceValidationResult {
  officialTotalMatchesSummary: boolean;
  cardSubtotalsMatchOfficialTotal: boolean;
  reconstructedEntriesMatchSubtotals: boolean;
  futureProjectionMatchesProviderBalance: boolean | null;
  summaryDifferenceCents: number;
  cardSubtotalDifferenceCents: number;
  entryDifferenceCents: number;
  futureProjectionDifferenceCents: number | null;
}

export interface ParsedInvoice {
  bankCode: string | null;
  bankName: string | null;
  parserName: string;
  parserVersion: string;
  cardLastFour: string | null;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
  closingDate: string | null;
  dueDate: string | null;
  officialTotalCents: number | null;
  previousBalanceCents: number | null;
  currencyCode: string;
  entries: ParsedInvoiceEntry[];
  confidence: number;
  fieldConfidence: Record<string, number>;
  warnings: string[];
  pageCount: number;
  minimumPaymentCents?: number | null;
  nextOpenInvoiceAmountCents?: number | null;
  nextCycleStartDate?: string | null;
  nextCycleEndDate?: string | null;
  providerFutureInstallmentBalanceCents?: number | null;
  cardSections?: ParsedCardSection[];
  santanderSummary?: SantanderInvoiceSummary | null;
  validation?: InvoiceValidationResult | null;
}

export interface InvoiceParser {
  readonly name: string;
  readonly version: string;
  readonly priority: number;
  canParse(document: ExtractedPdfDocument): number;
  parse(document: ExtractedPdfDocument, context?: { referenceYear?: number }): ParsedInvoice;
  validate(result: ParsedInvoice): string[];
}

export interface InvoiceReconciliation {
  officialTotalCents: number | null;
  purchasesCents: number;
  creditsCents: number;
  paymentsCents: number;
  financeChargesCents: number;
  previousBalanceCents: number;
  reconstructedTotalCents: number;
  differenceCents: number | null;
  status: "matched" | "different" | "unavailable";
}

export interface InstallmentProjection {
  competenceMonth: string;
  installmentNumber: number;
  totalInstallments: number;
  amountCents: number;
  dueDate: string;
  status: "posted" | "projected";
}

export interface InvoiceReviewState {
  documentId: string;
  originalFilename: string;
  cardId: string;
  cardName: string;
  parsed: ParsedInvoice;
  reconciliation: InvoiceReconciliation;
  extractionMethod?: ExtractedPdfDocument["extractionMethod"];
  statementComparison?: {
    statementId: string;
    pluggyBillTotalCents: number | null;
    pdfTotalCents: number | null;
    selectedTotalSource: "statement_pdf" | "pluggy_bill";
  };
}

export interface FutureCardCommitment {
  competenceMonth: string;
  installmentCommitmentsCents: number;
  recurringCommitmentsCents: number;
  otherKnownCommitmentsCents: number;
  totalCommittedCents: number;
  sourceCount: number;
  confidence: number;
}

export interface InvoiceImportResult {
  documentId: string;
  billId: string;
  entriesCreated: number;
  installmentPlansCreated: number;
  occurrencesCreated: number;
}

export const confidenceLevel = (value: number): ConfidenceLevel =>
  value >= .9 ? "high" : value >= .75 ? "medium" : "low";
