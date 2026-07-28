export type ExistingInvoiceDocumentAction =
  | "open_bill"
  | "continue_review"
  | "retry"
  | "wait"
  | "continue_processing";

export type ExistingInvoiceDocumentStatus =
  | "confirmed"
  | "needs_review"
  | "failed"
  | "processing"
  | "uploaded";

export type ExistingInvoiceDocumentResolution = {
  status: "existing";
  documentId: string;
  documentStatus: ExistingInvoiceDocumentStatus;
  action: ExistingInvoiceDocumentAction;
  message: string;
  billId: string | null;
  cardId: string;
  canReplace: boolean;
  canDelete: boolean;
  processingAttempts: number;
  errorCode: string | null;
};

export type InvoiceDocumentStateRow = {
  id: string;
  card_id: string;
  bill_id: string | null;
  processing_status: string;
  review_status: string;
  confirmed_at: string | null;
  processing_lock_until?: string | null;
  processing_attempts?: number | null;
  processing_error_code?: string | null;
  last_processing_error_code?: string | null;
  deleted_at?: string | null;
};

function failedDocumentMessage(errorCode: string | null, attempts: number) {
  if (errorCode === "STORAGE_FILE_MISSING") {
    return "O arquivo original não foi encontrado. Substitua o documento para continuar.";
  }
  if (errorCode === "PASSWORD_PROTECTED") {
    return "Este PDF está protegido por senha.";
  }
  if (errorCode === "IMAGE_ONLY_PDF" || errorCode === "EMPTY_EXTRACTED_TEXT") {
    return "Este documento não possui texto pesquisável.";
  }
  if (
    errorCode &&
    [
      "PDF_LIBRARY_LOAD_FAILED",
      "PDF_DOCUMENT_LOAD_FAILED",
      "PDF_PAGE_LOAD_FAILED",
      "PDF_PAGE_TEXT_FAILED",
      "PDF_TEXT_CONTENT_FAILED",
      "PDF_PAGE_ITEM_MAPPING_FAILED",
      "TEXT_EXTRACTION_FAILED",
      "UNKNOWN_PROCESSING_ERROR",
    ].includes(errorCode)
  ) {
    return "Não foi possível concluir a leitura automática. Tente novamente.";
  }
  return attempts >= 3
    ? "Não conseguimos ler este documento automaticamente. Você pode tentar novamente ou preencher os dados manualmente."
    : "Este documento já foi enviado, mas o processamento falhou.";
}

export function resolveExistingInvoiceDocumentAction(
  row: InvoiceDocumentStateRow,
  now = new Date(),
): ExistingInvoiceDocumentResolution {
  const confirmed =
    row.processing_status === "confirmed" ||
    row.review_status === "approved" ||
    Boolean(row.confirmed_at);
  const attempts = Math.max(0, Number(row.processing_attempts ?? 0));
  const base = {
    status: "existing" as const,
    documentId: row.id,
    billId: row.bill_id,
    cardId: row.card_id,
    processingAttempts: attempts,
    errorCode:
      row.last_processing_error_code ?? row.processing_error_code ?? null,
  };
  if (confirmed) {
    return {
      ...base,
      documentStatus: "confirmed",
      action: "open_bill",
      message: "Esta fatura já foi importada e confirmada.",
      canReplace: false,
      canDelete: false,
    };
  }
  const lockActive = Boolean(
    row.processing_lock_until &&
      new Date(row.processing_lock_until).getTime() > now.getTime(),
  );
  if (["extracting", "parsing"].includes(row.processing_status) && lockActive) {
    return {
      ...base,
      documentStatus: "processing",
      action: "wait",
      message: "Este documento já está sendo processado.",
      canReplace: false,
      canDelete: false,
    };
  }
  if (["needs_review", "parsed", "extracted"].includes(row.processing_status)) {
    return {
      ...base,
      documentStatus: "needs_review",
      action: "continue_review",
      message: "Este documento já foi processado e aguarda revisão.",
      canReplace: true,
      canDelete: true,
    };
  }
  if (row.processing_status === "uploaded") {
    return {
      ...base,
      documentStatus: "uploaded",
      action: "continue_processing",
      message: "Este documento já foi enviado e ainda não foi processado.",
      canReplace: true,
      canDelete: true,
    };
  }
  return {
    ...base,
    documentStatus: "failed",
    action: "retry",
    message: failedDocumentMessage(base.errorCode, attempts),
    canReplace: true,
    canDelete: true,
  };
}
