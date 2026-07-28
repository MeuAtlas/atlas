export type InvoiceUploadResponse = {
  status: "uploaded" | "existing" | "failed";
  documentId: string;
  nextStep: "processing" | "review" | "confirmed" | "retry";
  message?: string;
};

export type InvoiceProcessingResponse = {
  status: "parsed" | "needs_review" | "failed";
  documentId: string;
  parsedInvoiceId?: string;
  entriesCount: number;
  installmentsCount: number;
  warningsCount: number;
  nextStep: "review" | "retry";
  pageCount?: number;
  extractionMethod?: string;
  nextUrl?: string;
};

export const invoiceImportCanonicalPath = (documentId: string) =>
  `/financeiro/cartoes/importar-fatura/${encodeURIComponent(documentId)}`;

export const processingResponseFromReview = (review: {
  documentId: string;
  extractionMethod?: string;
  parsed: {
    pageCount?: number;
    entries: Array<{ installment?: unknown }>;
    warnings?: string[] | null;
  };
}): InvoiceProcessingResponse => ({
  status: "needs_review",
  documentId: review.documentId,
  entriesCount: review.parsed.entries?.length ?? 0,
  installmentsCount:
    review.parsed.entries?.filter(entry => entry.installment).length ?? 0,
  warningsCount: review.parsed.warnings?.length ?? 0,
  nextStep: "review",
  pageCount: review.parsed.pageCount ?? 0,
  extractionMethod: review.extractionMethod,
  nextUrl: invoiceImportCanonicalPath(review.documentId),
});
