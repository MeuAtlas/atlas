import "server-only";

const masked = (value: string) => value.length < 8 ? "***" : `${value.slice(0, 4)}…${value.slice(-4)}`;

export function logInvoiceImport(event: {
  operation: "process" | "confirm" | "reprocess" | "extract";
  documentId: string;
  workspaceId?: string;
  parser?: string;
  pages?: number;
  entriesCount?: number;
  installmentsCount?: number;
  confidence?: number;
  durationMs: number;
  status: "success" | "failed";
  errorCode?: string;
  stage?: string;
  page?: number;
  textItemCount?: number;
  characterCount?: number;
  extractionMethod?: string;
  diagnostic?: Record<string, unknown>;
}) {
  console.info("invoice_import", {
    operation: event.operation,
    document_id: masked(event.documentId),
    workspace_id: event.workspaceId ? masked(event.workspaceId) : undefined,
    parser: event.parser,
    page_count: event.pages,
    entries_count: event.entriesCount,
    installments_count: event.installmentsCount,
    confidence: event.confidence,
    duration_ms: event.durationMs,
    status: event.status,
    error_code: event.errorCode,
    stage: event.stage,
    page: event.page,
    text_item_count: event.textItemCount,
    character_count: event.characterCount,
    extraction_method: event.extractionMethod,
    diagnostic: event.diagnostic,
  });
}
