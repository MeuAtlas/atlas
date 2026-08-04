import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { logSupabaseError, normalizeSupabaseError } from "@/lib/errors";
import {
  extractPdfText,
  normalizePdfExtractionError,
  PdfExtractionError,
  toPdfUint8Array,
  validatePdfBytes,
  type PdfBinaryInput,
} from "./extract-pdf";
import {
  resolveExistingInvoiceDocumentAction,
  type ExistingInvoiceDocumentResolution,
  type InvoiceDocumentStateRow,
} from "./existing-document";
import { parseInvoiceDocument } from "./parser-registry";
import { reconcileInvoice } from "./reconciliation";
import type {
  InvoiceImportResult,
  InvoiceReviewState,
  ParsedInvoice,
} from "./types";
import { logInvoiceImport } from "./logger";
import {
  invoicePeriodMatchesReferenceMonth,
  normalizeInvoiceEntryInstallments,
} from "./validation";

const BUCKET = "financial-documents";
const DOCUMENT_COLUMNS =
  "id,workspace_id,user_id,card_id,bill_id,target_statement_id,supersedes_document_id,storage_bucket,storage_path,original_filename,file_hash,file_size_bytes,mime_type,bank_code,bank_name,parser_name,parser_version,processing_version,extraction_method,extraction_layout_version,parser_warnings,provider_future_installment_balance,next_open_invoice_amount,next_cycle_start_date,next_cycle_end_date,extracted_text,parsed_payload,processing_status,confidence,processing_error_code,processing_error_message,review_status,imported_at,confirmed_at,created_at,updated_at,deleted_at,processing_attempts,processing_started_at,processing_lock_until,last_processing_attempt_at,last_processing_error_code,last_processing_error_message";

const safeFilename = (value: string) =>
  value.replace(/[\r\n]/g, " ").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180);

export class InvoiceImportError extends Error {
  constructor(
    public code: string,
    message: string,
    options?: {
      cause?: unknown;
      stage?: string;
      status?: number;
      diagnostic?: Record<string, unknown>;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "InvoiceImportError";
    this.stage = options?.stage;
    this.status = options?.status;
    this.diagnostic = options?.diagnostic;
  }

  stage?: string;
  status?: number;
  diagnostic?: Record<string, unknown>;
}

export type ProcessInvoicePdfResult =
  | { status: "processed"; review: InvoiceReviewState }
  | ExistingInvoiceDocumentResolution;

type InvoiceDocumentRow = InvoiceDocumentStateRow & {
  workspace_id: string;
  user_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  file_hash: string;
  file_size_bytes: number;
  mime_type: string;
  processing_version: number;
  parsed_payload: unknown;
  extracted_text: string | null;
  processing_error_message: string | null;
  last_processing_error_message: string | null;
  extraction_method: string | null;
  target_statement_id: string | null;
};

function validateUploadedPdf(file: File) {
  if (file.type !== "application/pdf" || !/\.pdf$/i.test(file.name)) {
    throw new InvoiceImportError("INVALID_PDF", "Este arquivo não parece ser um PDF válido.");
  }
}

function validateBuffer(buffer: Uint8Array) {
  try {
    validatePdfBytes(buffer);
  } catch (error) {
    const code =
      error instanceof PdfExtractionError ? error.code : "INVALID_PDF";
    if (code === "PDF_TOO_LARGE") {
      throw new InvoiceImportError("PDF_TOO_LARGE", "O arquivo excede o limite de 20 MB.");
    }
    throw new InvoiceImportError("INVALID_PDF", "Este arquivo não parece ser um PDF válido.");
  }
}

function processingFailure(error: unknown) {
  if (error instanceof InvoiceImportError) return error;
  if (error instanceof PdfExtractionError) {
    const publicMessages: Record<string, string> = {
      PASSWORD_PROTECTED: "Este PDF está protegido por senha.",
      PDF_LIBRARY_LOAD_FAILED: "Não foi possível iniciar a leitura automática do PDF.",
      PDF_DOCUMENT_LOAD_FAILED: "Não foi possível abrir a estrutura deste PDF.",
      PDF_PAGE_LOAD_FAILED: "Não foi possível carregar uma das páginas do PDF.",
      PDF_PAGE_TEXT_FAILED: "Não foi possível ler a camada de texto de uma das páginas do PDF.",
      PDF_TEXT_CONTENT_FAILED: "Não foi possível ler a camada de texto deste PDF.",
      PDF_PAGE_ITEM_MAPPING_FAILED: "Não foi possível interpretar os itens de texto de uma das páginas.",
      EMPTY_EXTRACTED_TEXT: "Este documento não possui texto pesquisável.",
      TEXT_EXTRACTION_FAILED: "Não foi possível concluir a leitura automática.",
    };
    return new InvoiceImportError(
      error.code,
      publicMessages[error.code] ?? "Não foi possível processar este documento.",
      {
        cause: error,
        stage: error.stage,
        status: ["PASSWORD_PROTECTED", "EMPTY_EXTRACTED_TEXT"].includes(error.code)
          ? 422
          : 500,
        diagnostic: normalizePdfExtractionError(error),
      },
    );
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "password_protected_pdf") {
    return new InvoiceImportError("PASSWORD_PROTECTED", "Este PDF está protegido por senha.");
  }
  if (code === "pdf_extraction_failed") {
    return new InvoiceImportError("TEXT_EXTRACTION_FAILED", "Não foi possível extrair o texto deste PDF.");
  }
  if (code === "invoice_parser_not_found") {
    return new InvoiceImportError("PARSER_FAILED", "O texto foi extraído, mas o modelo da fatura não foi reconhecido.");
  }
  return new InvoiceImportError("UNKNOWN_PROCESSING_ERROR", "Não foi possível processar este documento.");
}

function manualParsedInvoice(input: {
  pageCount: number;
  warning: string;
  imageOnly?: boolean;
}): ParsedInvoice {
  return {
    bankCode: null,
    bankName: null,
    parserName: "manual_assisted",
    parserVersion: "1.0.0",
    cardLastFour: null,
    cycleStartDate: null,
    cycleEndDate: null,
    closingDate: null,
    dueDate: null,
    officialTotalCents: null,
    previousBalanceCents: null,
    currencyCode: "BRL",
    entries: [],
    confidence: 0,
    fieldConfidence: {},
    warnings: [input.warning],
    pageCount: Math.max(1, input.pageCount),
  };
}

async function failProcessing(
  supabase: SupabaseClient,
  documentId: string,
  failure: InvoiceImportError,
) {
  const result = await supabase.rpc("fail_invoice_document_processing", {
    p_document_id: documentId,
    p_error_code: failure.code,
    p_error_message: failure.message,
  });
  if (result.error) {
    await supabase.from("invoice_documents").update({
      processing_status: "failed",
      processing_lock_until: null,
      processing_error_code: failure.code,
      processing_error_message: failure.message,
      last_processing_error_code: failure.code,
      last_processing_error_message: failure.message,
    }).eq("id", documentId);
  }
}

async function acquireProcessing(supabase: SupabaseClient, documentId: string) {
  const result = await supabase.rpc("acquire_invoice_document_processing", {
    p_document_id: documentId,
    p_lock_seconds: 300,
  });
  if (result.error) {
    throw new InvoiceImportError("PROCESSING_LOCK_FAILED", "Não foi possível iniciar o processamento.");
  }
  if (!result.data) {
    throw new InvoiceImportError("PROCESSING_IN_PROGRESS", "Este documento já está sendo processado.");
  }
}

export async function downloadInvoicePdfBytes(
  supabase: SupabaseClient,
  document: Pick<
    InvoiceDocumentRow,
    | "id"
    | "workspace_id"
    | "storage_bucket"
    | "storage_path"
    | "file_hash"
    | "file_size_bytes"
    | "mime_type"
  >,
) {
  const startedAt = Date.now();
  const downloaded = await supabase.storage
    .from(document.storage_bucket)
    .download(document.storage_path);
  if (downloaded.error || !downloaded.data) {
    const missing = /not found|does not exist|404/i.test(
      downloaded.error?.message ?? "",
    );
    throw new InvoiceImportError(
      missing ? "STORAGE_FILE_MISSING" : "STORAGE_DOWNLOAD_FAILED",
      missing
        ? "O arquivo original não foi encontrado. Substitua o documento para continuar."
        : "Não foi possível baixar o arquivo original.",
      {
        cause: downloaded.error,
        stage: "storage_download",
        status: missing ? 404 : 503,
      },
    );
  }
  if (!(downloaded.data instanceof Blob) || downloaded.data.size <= 0) {
    throw new InvoiceImportError(
      "STORAGE_DOWNLOAD_FAILED",
      "O arquivo original retornou vazio ou em formato inesperado.",
      {
        stage: "storage_download",
        status: 503,
        diagnostic: {
          inputType: downloaded.data?.constructor?.name ?? typeof downloaded.data,
          byteLength: downloaded.data?.size ?? 0,
        },
      },
    );
  }
  if (
    downloaded.data.type &&
    !["application/pdf", "application/octet-stream"].includes(
      downloaded.data.type.toLowerCase(),
    )
  ) {
    throw new InvoiceImportError(
      "INVALID_PDF",
      "O arquivo armazenado não possui o tipo PDF esperado.",
      {
        stage: "pdf_validation",
        status: 400,
        diagnostic: {
          inputType: downloaded.data.constructor.name,
          byteLength: downloaded.data.size,
          mimeType: downloaded.data.type,
        },
      },
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await toPdfUint8Array(downloaded.data as PdfBinaryInput);
    validatePdfBytes(bytes);
  } catch (error) {
    const failure = processingFailure(error);
    failure.diagnostic = {
      ...failure.diagnostic,
      inputType: downloaded.data.constructor.name,
      byteLength: downloaded.data.size,
    };
    failure.stage = failure.stage ?? "pdf_validation";
    throw failure;
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (document.file_hash && actualHash !== document.file_hash) {
    throw new InvoiceImportError(
      "PDF_HASH_MISMATCH",
      "O arquivo armazenado não corresponde ao documento enviado.",
      {
        stage: "pdf_validation",
        status: 500,
        diagnostic: {
          byteLength: bytes.byteLength,
          expectedSize: document.file_size_bytes,
          mimeType: downloaded.data.type || document.mime_type,
        },
      },
    );
  }
  logInvoiceImport({
    operation: "extract",
    documentId: document.id,
    workspaceId: document.workspace_id,
    durationMs: Date.now() - startedAt,
    status: "success",
    stage: "storage_download",
    diagnostic: {
      inputType: downloaded.data.constructor.name,
      byteLength: bytes.byteLength,
      mimeType: downloaded.data.type || document.mime_type,
      hashVerified: Boolean(document.file_hash),
    },
  });
  return bytes;
}

async function cardName(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
) {
  const result = await supabase.from("credit_cards").select("name")
    .eq("id", cardId).eq("owner_id", userId).maybeSingle();
  return String(result.data?.name ?? "Cartão");
}

async function statementComparison(
  supabase: SupabaseClient,
  userId: string,
  document: InvoiceDocumentRow,
  pdfTotalCents: number | null,
): Promise<InvoiceReviewState["statementComparison"]> {
  if (!document.target_statement_id) return undefined;
  const result = await supabase.from("card_invoices")
    .select("id,provider_invoice_total,pluggy_bill_total_amount")
    .eq("id", document.target_statement_id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (result.error || !result.data) {
    throw new InvoiceImportError(
      "TARGET_STATEMENT_NOT_FOUND",
      "A fatura escolhida não está mais disponível.",
    );
  }
  const pluggy = result.data.pluggy_bill_total_amount ?? result.data.provider_invoice_total;
  return {
    statementId: result.data.id,
    pluggyBillTotalCents: pluggy == null ? null : Math.round(Number(pluggy) * 100),
    pdfTotalCents,
    selectedTotalSource: "statement_pdf",
  };
}

async function validateTargetStatementPeriod(input: {
  supabase: SupabaseClient;
  userId: string;
  document: InvoiceDocumentRow;
  parsed: ParsedInvoice;
}) {
  if (!input.document.target_statement_id) return;
  const target = await input.supabase.from("card_invoices")
    .select("id,card_id,reference_month,status")
    .eq("id", input.document.target_statement_id)
    .eq("owner_id", input.userId)
    .maybeSingle();
  if (target.error || !target.data) {
    throw new InvoiceImportError(
      "TARGET_STATEMENT_NOT_FOUND",
      "A fatura escolhida não está mais disponível.",
      { status: 422, stage: "target_statement_validation" },
    );
  }
  if (!input.parsed.dueDate) {
    throw new InvoiceImportError(
      "TARGET_STATEMENT_PERIOD_NOT_IDENTIFIED",
      "Não foi possível identificar no PDF o mês de vencimento da fatura selecionada.",
      { status: 422, stage: "target_statement_validation" },
    );
  }
  const extractedReferenceMonth = `${input.parsed.dueDate.slice(0, 7)}-01`;
  if (
    target.data.card_id !== input.document.card_id ||
    !invoicePeriodMatchesReferenceMonth(
      input.parsed,
      target.data.reference_month,
    ) ||
    ["open", "estimated", "cancelled"].includes(target.data.status)
  ) {
    const [year, month] = extractedReferenceMonth.split("-");
    throw new InvoiceImportError(
      "TARGET_STATEMENT_MISMATCH",
      `O PDF corresponde ao vencimento ${month}/${year} e não à fatura selecionada. Escolha a fatura correta antes de revisar os lançamentos.`,
      { status: 422, stage: "target_statement_validation" },
    );
  }
}

async function persistReviewAtomically(input: {
  supabase: SupabaseClient;
  userId: string;
  document: InvoiceDocumentRow;
  review: InvoiceReviewState;
  version: number;
  extractionMethod: string | null;
}) {
  const persisted = await input.supabase.rpc("persist_invoice_import_review", {
    p_document_id: input.document.id,
    p_version: input.version,
    p_review: input.review,
  });
  if (!persisted.error && persisted.data === true) return;

  const rpcUnavailable =
    persisted.error?.code === "PGRST202" ||
    persisted.error?.code === "42883" ||
    /persist_invoice_import_review/i.test(persisted.error?.message ?? "");
  if (!rpcUnavailable) {
    throw new InvoiceImportError(
      "DATABASE_WRITE_FAILED",
      "Não foi possível salvar o processamento.",
    );
  }

  const parsed = input.review.parsed;
  const updated = await input.supabase
    .from("invoice_documents")
    .update({
      processing_version: input.version,
      bank_code: parsed.bankCode,
      bank_name: parsed.bankName,
      parser_name: parsed.parserName,
      parser_version: parsed.parserVersion,
      parsed_payload: input.review,
      processing_status: "needs_review",
      review_status: "in_review",
      confidence: parsed.confidence,
      parser_warnings: parsed.warnings ?? [],
      provider_future_installment_balance:
        parsed.providerFutureInstallmentBalanceCents == null
          ? null
          : parsed.providerFutureInstallmentBalanceCents / 100,
      next_open_invoice_amount:
        parsed.nextOpenInvoiceAmountCents == null
          ? null
          : parsed.nextOpenInvoiceAmountCents / 100,
      next_cycle_start_date: parsed.nextCycleStartDate ?? null,
      next_cycle_end_date: parsed.nextCycleEndDate ?? null,
      processing_lock_until: null,
      processing_error_code:
        parsed.parserName === "manual_assisted"
          ? input.extractionMethod === "image_only"
            ? "IMAGE_ONLY_PDF"
            : "UNSUPPORTED_LAYOUT"
          : null,
      processing_error_message:
        parsed.parserName === "manual_assisted"
          ? parsed.warnings?.[0] ?? null
          : null,
      last_processing_error_code: null,
      last_processing_error_message: null,
    })
    .eq("id", input.document.id)
    .eq("user_id", input.userId);
  if (updated.error) {
    throw new InvoiceImportError(
      "DATABASE_WRITE_FAILED",
      "Não foi possível salvar o processamento.",
    );
  }
  const versioned = await input.supabase
    .from("invoice_processing_versions")
    .upsert(
      {
        document_id: input.document.id,
        owner_id: input.userId,
        version: input.version,
        parser_name: parsed.parserName,
        parser_version: parsed.parserVersion,
        parsed_payload: input.review,
        confidence: parsed.confidence,
      },
      { onConflict: "document_id,version" },
    );
  if (versioned.error) {
    await failProcessing(
      input.supabase,
      input.document.id,
      new InvoiceImportError(
        "INCOMPLETE_REVIEW_PAYLOAD",
        "A revisão não foi persistida por completo.",
      ),
    );
    throw new InvoiceImportError(
      "DATABASE_WRITE_FAILED",
      "Não foi possível salvar o processamento.",
    );
  }
}

async function processStoredBuffer(input: {
  supabase: SupabaseClient;
  userId: string;
  document: InvoiceDocumentRow;
  buffer: Uint8Array;
  operation: "process" | "reprocess";
}): Promise<InvoiceReviewState> {
  const startedAt = Date.now();
  try {
    const extracted = await extractPdfText(input.buffer);
    const storedExtractionMethod =
      extracted.extractionMethod === "image_only" ? "image_only" : "text_layer";
    logInvoiceImport({
      operation: "extract",
      documentId: input.document.id,
      workspaceId: input.document.workspace_id,
      pages: extracted.pageCount,
      textItemCount: extracted.itemCount ?? extracted.pages.reduce(
        (count, page) => count + page.items.length,
        0,
      ),
      characterCount:
        extracted.characterCount ??
        extracted.quality?.characterCount ??
        extracted.fullText.length,
      extractionMethod: extracted.extractionMethod,
      durationMs: Date.now() - startedAt,
      status: "success",
      stage: "complete",
    });
    const extractionState = {
      processing_status: "extracted",
      extraction_method: storedExtractionMethod,
      extraction_layout_version:
        ["pdfjs_text_layer", "pdfjs_legacy"].includes(extracted.extractionMethod)
          ? 3
          : null,
      extracted_text: extracted.fullText.slice(0, 20_000) || null,
    };
    let extractedUpdate = await input.supabase.from("invoice_documents").update({
      ...extractionState,
      extractor_version: extracted.extractorVersion ?? "pdfjs-dist@6.1.200",
      page_count: extracted.pageCount,
      extracted_character_count:
        extracted.quality?.characterCount ?? extracted.fullText.length,
      extraction_warnings: extracted.extractionWarnings,
    }).eq("id", input.document.id).eq("user_id", input.userId);
    if (
      extractedUpdate.error &&
      ["PGRST204", "42703"].includes(extractedUpdate.error.code ?? "")
    ) {
      extractedUpdate = await input.supabase.from("invoice_documents")
        .update(extractionState)
        .eq("id", input.document.id)
        .eq("user_id", input.userId);
    }
    if (extractedUpdate.error) {
      throw new InvoiceImportError(
        "DATABASE_WRITE_FAILED",
        "Não foi possível salvar o texto extraído.",
        { cause: extractedUpdate.error, stage: "extraction_persistence" },
      );
    }
    const parsingUpdate = await input.supabase.from("invoice_documents").update({
      processing_status: "parsing",
    }).eq("id", input.document.id).eq("user_id", input.userId);
    if (parsingUpdate.error) {
      throw new InvoiceImportError(
        "DATABASE_WRITE_FAILED",
        "Não foi possível iniciar o parser da fatura.",
        { cause: parsingUpdate.error, stage: "parser" },
      );
    }

    let parsed: ParsedInvoice;
    if (extracted.extractionMethod === "image_only") {
      parsed = manualParsedInvoice({
        pageCount: extracted.pageCount,
        imageOnly: true,
        warning: "Este PDF parece ser uma imagem e não possui texto pesquisável.",
      });
    } else {
      try {
        parsed = parseInvoiceDocument(extracted);
      } catch {
        parsed = manualParsedInvoice({
          pageCount: extracted.pageCount,
          warning: "O texto foi extraído, mas o modelo da fatura não foi reconhecido. Preencha os dados manualmente.",
        });
      }
    }
    await validateTargetStatementPeriod({
      supabase: input.supabase,
      userId: input.userId,
      document: input.document,
      parsed,
    });
    const reconciliation = reconcileInvoice({
      officialTotalCents: parsed.officialTotalCents,
      previousBalanceCents: parsed.previousBalanceCents,
      entries: parsed.entries,
    });
    const review: InvoiceReviewState = {
      documentId: input.document.id,
      originalFilename: input.document.original_filename,
      cardId: input.document.card_id,
      cardName: await cardName(input.supabase, input.userId, input.document.card_id),
      parsed,
      reconciliation,
      extractionMethod: extracted.extractionMethod,
      statementComparison: await statementComparison(
        input.supabase,
        input.userId,
        input.document,
        parsed.officialTotalCents,
      ),
    };
    const version = input.operation === "process"
      ? Math.max(1, Number(input.document.processing_version ?? 1))
      : Number(input.document.processing_version ?? 1) + 1;
    await persistReviewAtomically({
      supabase: input.supabase,
      userId: input.userId,
      document: input.document,
      review,
      version,
      extractionMethod: extracted.extractionMethod,
    });
    logInvoiceImport({
      operation: input.operation,
      documentId: input.document.id,
      workspaceId: input.document.workspace_id,
      parser: parsed.parserName,
      pages: parsed.pageCount,
      entriesCount: parsed.entries.length,
      installmentsCount: parsed.entries.filter(entry => entry.installment).length,
      confidence: parsed.confidence,
      durationMs: Date.now() - startedAt,
      status: "success",
    });
    return review;
  } catch (error) {
    const failure = processingFailure(error);
    failure.diagnostic = {
      ...failure.diagnostic,
      inputType: input.buffer.constructor.name,
      byteLength: input.buffer.byteLength,
    };
    await failProcessing(input.supabase, input.document.id, failure);
    logInvoiceImport({
      operation: input.operation,
      documentId: input.document.id,
      workspaceId: input.document.workspace_id,
      durationMs: Date.now() - startedAt,
      status: "failed",
      errorCode: failure.code,
      stage: failure.stage,
      page:
        typeof failure.diagnostic?.pageNumber === "number"
          ? failure.diagnostic.pageNumber
          : undefined,
      diagnostic: failure.diagnostic,
    });
    throw failure;
  }
}

async function ownedCardAndWorkspace(input: {
  supabase: SupabaseClient;
  userId: string;
  cardId: string;
}) {
  const cardResult = await input.supabase.from("credit_cards")
    .select("id,name,workspace_id,owner_id,status").eq("id", input.cardId)
    .eq("owner_id", input.userId).eq("status", "active").maybeSingle();
  if (cardResult.error || !cardResult.data) {
    throw new InvoiceImportError("CARD_NOT_AUTHORIZED", "O cartão selecionado não está disponível.");
  }
  let workspaceId = cardResult.data.workspace_id as string | null;
  if (!workspaceId) {
    const workspace = await input.supabase.from("workspaces").select("id")
      .eq("owner_id", input.userId).order("created_at").limit(1).maybeSingle();
    workspaceId = workspace.data?.id ?? null;
  }
  if (!workspaceId) {
    throw new InvoiceImportError("WORKSPACE_NOT_FOUND", "Não foi possível identificar o espaço financeiro.");
  }
  return { card: cardResult.data, workspaceId };
}

async function findByHash(input: {
  supabase: SupabaseClient;
  workspaceId: string;
  cardId: string;
  fileHash: string;
  excludeId?: string;
}) {
  let query = input.supabase.from("invoice_documents").select(DOCUMENT_COLUMNS)
    .eq("workspace_id", input.workspaceId)
    .eq("card_id", input.cardId)
    .eq("file_hash", input.fileHash)
    .is("deleted_at", null);
  if (input.excludeId) query = query.neq("id", input.excludeId);
  const result = await query.maybeSingle();
  return (result.data ?? null) as InvoiceDocumentRow | null;
}

export async function uploadInvoicePdf(input: {
  supabase: SupabaseClient;
  userId: string;
  cardId: string;
  targetStatementId?: string | null;
  file: File;
}): Promise<ExistingInvoiceDocumentResolution> {
  validateUploadedPdf(input.file);
  const buffer = Buffer.from(await input.file.arrayBuffer());
  validateBuffer(buffer);
  const { workspaceId } = await ownedCardAndWorkspace(input);
  if (input.targetStatementId) {
    const target = await input.supabase.from("card_invoices")
      .select("id,card_id,status")
      .eq("id", input.targetStatementId)
      .eq("owner_id", input.userId)
      .maybeSingle();
    if (target.error || !target.data || target.data.card_id !== input.cardId ||
      ["open", "estimated", "cancelled"].includes(target.data.status)) {
      throw new InvoiceImportError(
        "INVALID_TARGET_STATEMENT",
        "A fatura escolhida não pode receber este documento.",
      );
    }
  }
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const existing = await findByHash({
    supabase: input.supabase,
    workspaceId,
    cardId: input.cardId,
    fileHash,
  });
  if (existing) {
    if (
      input.targetStatementId &&
      !existing.confirmed_at &&
      existing.target_statement_id !== input.targetStatementId
    ) {
      const reassigned = await input.supabase.from("invoice_documents")
        .update({ target_statement_id: input.targetStatementId })
        .eq("id", existing.id)
        .eq("user_id", input.userId)
        .is("deleted_at", null)
        .select(DOCUMENT_COLUMNS)
        .maybeSingle();
      if (reassigned.error || !reassigned.data) {
        throw new InvoiceImportError(
          "DATABASE_WRITE_FAILED",
          "Não foi possível vincular o documento à fatura selecionada.",
        );
      }
      return resolveExistingInvoiceDocumentAction(
        reassigned.data as InvoiceDocumentRow,
      );
    }
    return resolveExistingInvoiceDocumentAction(existing);
  }

  const now = new Date();
  const documentId = randomUUID();
  const path = `${workspaceId}/${input.userId}/credit-card-bills/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${documentId}.pdf`;
  const uploaded = await input.supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: false,
    cacheControl: "private, max-age=0",
  });
  if (uploaded.error) {
    throw new InvoiceImportError("STORAGE_UPLOAD_FAILED", "Não foi possível armazenar este documento.");
  }

  const created = await input.supabase.from("invoice_documents").insert({
    id: documentId,
    workspace_id: workspaceId,
    user_id: input.userId,
    card_id: input.cardId,
    target_statement_id: input.targetStatementId ?? null,
    storage_bucket: BUCKET,
    storage_path: path,
    original_filename: safeFilename(input.file.name),
    file_hash: fileHash,
    file_size_bytes: buffer.length,
    mime_type: "application/pdf",
    processing_status: "uploaded",
    review_status: "pending",
  }).select(DOCUMENT_COLUMNS).single();
  if (created.error) {
    await input.supabase.storage.from(BUCKET).remove([path]);
    if (created.error.code === "23505") {
      const conflict = await findByHash({
        supabase: input.supabase,
        workspaceId,
        cardId: input.cardId,
        fileHash,
      });
      if (conflict) return resolveExistingInvoiceDocumentAction(conflict);
    }
    throw new InvoiceImportError("DATABASE_WRITE_FAILED", "Não foi possível registrar este documento.");
  }
  const document = created.data as InvoiceDocumentRow;
  return resolveExistingInvoiceDocumentAction(document);
}

export async function confirmInvoiceImport(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  review: InvoiceReviewState;
}): Promise<InvoiceImportResult> {
  const startedAt = Date.now();
  if (input.review.documentId !== input.documentId) {
    throw new InvoiceImportError("INVALID_REVIEW", "A revisão não pertence a este documento.");
  }
  if (!input.review.parsed.dueDate || input.review.parsed.officialTotalCents === null) {
    throw new InvoiceImportError("MISSING_REQUIRED_FIELDS", "Informe o vencimento e o total oficial antes de confirmar.");
  }
  const normalizedEntries = normalizeInvoiceEntryInstallments(
    input.review.parsed.entries,
  );
  const document = await input.supabase.from("invoice_documents")
    .select("target_statement_id,card_id")
    .eq("id", input.documentId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (document.error || !document.data) {
    throw new InvoiceImportError("DOCUMENT_NOT_FOUND", "Importação não encontrada.");
  }
  let verifiedPluggyBillTotalCents: number | null = null;
  if (document.data.target_statement_id) {
    const target = await input.supabase.from("card_invoices")
      .select("id,card_id,reference_month,status,provider_invoice_total,pluggy_bill_total_amount")
      .eq("id", document.data.target_statement_id)
      .eq("owner_id", input.userId)
      .maybeSingle();
    const statementDate = input.review.parsed.closingDate ??
      input.review.parsed.cycleEndDate ?? input.review.parsed.dueDate;
    const statementMonth = `${statementDate.slice(0, 7)}-01`;
    if (target.error || !target.data ||
      target.data.card_id !== input.review.cardId ||
      target.data.reference_month !== statementMonth ||
      ["open", "estimated", "cancelled"].includes(target.data.status)) {
      throw new InvoiceImportError(
        "TARGET_STATEMENT_MISMATCH",
        "O vencimento ou o cartão do PDF não corresponde à fatura escolhida.",
      );
    }
    const targetTotal = (target.data as typeof target.data & {
      provider_invoice_total?: number | null;
      pluggy_bill_total_amount?: number | null;
    }).pluggy_bill_total_amount ??
      (target.data as typeof target.data & { provider_invoice_total?: number | null }).provider_invoice_total;
    verifiedPluggyBillTotalCents = targetTotal == null
      ? null
      : Math.round(Number(targetTotal) * 100);
  }
  const selectedTotalSource = input.review.statementComparison?.selectedTotalSource ?? "statement_pdf";
  if (selectedTotalSource === "pluggy_bill" && verifiedPluggyBillTotalCents === null) {
    throw new InvoiceImportError(
      "PLUGGY_BILL_TOTAL_UNAVAILABLE",
      "O total da Pluggy não está disponível para esta fatura.",
    );
  }
  const selectedTotalCents = selectedTotalSource === "pluggy_bill"
    ? verifiedPluggyBillTotalCents!
    : input.review.parsed.officialTotalCents;
  const reconciliation = reconcileInvoice({
    officialTotalCents: selectedTotalCents,
    previousBalanceCents: input.review.parsed.previousBalanceCents,
    entries: normalizedEntries,
  });
  const confirmedReview = {
    ...input.review,
    parsed: {
      ...input.review.parsed,
      officialTotalCents: selectedTotalCents,
      entries: normalizedEntries,
    },
    reconciliation,
  };
  const result = await input.supabase.rpc("confirm_invoice_pdf_import", {
    p_document_id: input.documentId,
    p_review: confirmedReview,
  });
  if (result.error) {
    const context = `confirmar importação da fatura (${input.documentId})`;
    logSupabaseError(result.error, context);
    const diagnostic = normalizeSupabaseError(result.error, context);
    const developmentDetail = process.env.NODE_ENV === "development"
      ? [diagnostic.code, diagnostic.message, diagnostic.details]
        .filter(Boolean)
        .join(" · ")
      : "";
    throw new InvoiceImportError(
      "CONFIRMATION_FAILED",
      developmentDetail
        ? `Não foi possível confirmar a importação. Detalhe: ${developmentDetail}`
        : "Não foi possível confirmar a importação. A revisão foi preservada; tente novamente.",
    );
  }
  const foreignEnrichment = await input.supabase.rpc(
    "enrich_invoice_foreign_values",
    {
      p_document_id: input.documentId,
      p_entries: normalizedEntries,
    },
  );
  if (foreignEnrichment.error) {
    throw new InvoiceImportError(
      "FOREIGN_ENRICHMENT_FAILED",
      "A fatura foi confirmada, mas os valores em moeda estrangeira não puderam ser persistidos.",
    );
  }
  const imported = result.data as InvoiceImportResult;
  if (document.data.target_statement_id && imported.billId !== document.data.target_statement_id) {
    throw new InvoiceImportError(
      "TARGET_STATEMENT_MISMATCH",
      "O PDF foi processado para outro ciclo. A fatura escolhida foi preservada.",
    );
  }
  const axes = await input.supabase.from("card_invoices").update({
    pdf_total_amount: input.review.parsed.officialTotalCents / 100,
    pluggy_bill_total_amount: verifiedPluggyBillTotalCents == null
      ? undefined
      : verifiedPluggyBillTotalCents / 100,
    confirmed_total_amount: selectedTotalCents / 100,
    confirmed_total_source: selectedTotalSource,
    confirmed_total_source_locked: true,
    details_status: "confirmed",
  }).eq("id", imported.billId).eq("owner_id", input.userId);
  if (axes.error) {
    throw new InvoiceImportError(
      "STATEMENT_AXES_UPDATE_FAILED",
      "A fatura foi importada, mas a escolha do total não pôde ser registrada.",
    );
  }
  logInvoiceImport({
    operation: "confirm",
    documentId: input.documentId,
    entriesCount: imported.entriesCreated,
    installmentsCount: imported.installmentPlansCreated,
    durationMs: Date.now() - startedAt,
    status: "success",
  });
  return imported;
}

export async function saveInvoiceReviewDraft(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  review: InvoiceReviewState;
}) {
  if (input.review.documentId !== input.documentId) {
    throw new InvoiceImportError(
      "INVALID_REVIEW",
      "A revisão não pertence a este documento.",
    );
  }
  const reconciliation = reconcileInvoice({
    officialTotalCents: input.review.parsed.officialTotalCents,
    previousBalanceCents: input.review.parsed.previousBalanceCents,
    entries: input.review.parsed.entries ?? [],
  });
  const review = { ...input.review, reconciliation };
  const result = await input.supabase
    .from("invoice_documents")
    .update({
      parsed_payload: review,
      parser_warnings: review.parsed.warnings ?? [],
      confidence: review.parsed.confidence,
      processing_status: "needs_review",
      review_status: "in_review",
      processing_lock_until: null,
    })
    .eq("id", input.documentId)
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    throw new InvoiceImportError(
      "DRAFT_SAVE_FAILED",
      "Não foi possível salvar o rascunho desta revisão.",
    );
  }
  return { documentId: input.documentId, saved: true };
}

export async function getInvoiceDocument(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
) {
  const result = await supabase.from("invoice_documents").select(DOCUMENT_COLUMNS)
    .eq("id", documentId).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  if (result.error || !result.data) {
    throw new InvoiceImportError("DOCUMENT_NOT_FOUND", "Importação não encontrada.");
  }
  const document = result.data as InvoiceDocumentRow;
  return {
    document,
    resolution: resolveExistingInvoiceDocumentAction(document),
  };
}

export async function reprocessInvoiceDocument(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
}): Promise<InvoiceReviewState> {
  const { document, resolution } = await getInvoiceDocument(
    input.supabase,
    input.userId,
    input.documentId,
  );
  if (resolution.documentStatus === "confirmed") {
    throw new InvoiceImportError("CONFIRMED_DOCUMENT", "Uma fatura confirmada não pode ser reprocessada por este fluxo.");
  }
  await acquireProcessing(input.supabase, input.documentId);
  let verifiedBuffer: Uint8Array;
  try {
    verifiedBuffer = await downloadInvoicePdfBytes(input.supabase, document);
  } catch (error) {
    const failure = processingFailure(error);
    await failProcessing(input.supabase, input.documentId, failure);
    logInvoiceImport({
      operation: "reprocess",
      documentId: input.documentId,
      workspaceId: document.workspace_id,
      durationMs: 0,
      status: "failed",
      errorCode: failure.code,
      stage: failure.stage ?? "storage_download",
      diagnostic: failure.diagnostic,
    });
    throw failure;
  }
  const verifiedArrayBuffer = verifiedBuffer.buffer.slice(
    verifiedBuffer.byteOffset,
    verifiedBuffer.byteOffset + verifiedBuffer.byteLength,
  ) as ArrayBuffer;
  const downloaded: { error: { message: string } | null; data: Blob } = {
    error: null,
    data: new Blob([verifiedArrayBuffer], { type: document.mime_type }),
  };
  if (downloaded.error) {
    const failure = new InvoiceImportError(
      downloaded.error.message.toLowerCase().includes("not found")
        ? "STORAGE_FILE_MISSING"
        : "STORAGE_DOWNLOAD_FAILED",
      "O arquivo armazenado não foi encontrado. Substitua o PDF para continuar.",
    );
    await failProcessing(input.supabase, input.documentId, failure);
    throw failure;
  }
  const buffer = await toPdfUint8Array(downloaded.data);
  try {
    validateBuffer(buffer);
    const downloadedHash = createHash("sha256").update(buffer).digest("hex");
    if (document.file_hash && downloadedHash !== document.file_hash) {
      throw new InvoiceImportError(
        "PDF_HASH_MISMATCH",
        "O arquivo armazenado não corresponde ao documento enviado.",
        { stage: "pdf_validation", status: 500 },
      );
    }
  } catch (error) {
    const failure = processingFailure(error);
    await failProcessing(input.supabase, input.documentId, failure);
    throw failure;
  }
  return processStoredBuffer({
    supabase: input.supabase,
    userId: input.userId,
    document,
    buffer,
    operation: "reprocess",
  });
}

export async function prepareManualInvoiceReview(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
}): Promise<InvoiceReviewState> {
  const { document, resolution } = await getInvoiceDocument(
    input.supabase,
    input.userId,
    input.documentId,
  );
  if (resolution.documentStatus === "confirmed") {
    throw new InvoiceImportError(
      "CONFIRMED_DOCUMENT",
      "Uma fatura confirmada não pode voltar para revisão.",
    );
  }
  const parsed = manualParsedInvoice({
    pageCount: 1,
    warning:
      "Revisão manual iniciada. Preencha o resumo e adicione os lançamentos necessários.",
  });
  const review: InvoiceReviewState = {
    documentId: document.id,
    originalFilename: document.original_filename,
    cardId: document.card_id,
    cardName: await cardName(input.supabase, input.userId, document.card_id),
    parsed,
    reconciliation: reconcileInvoice({
      officialTotalCents: null,
      previousBalanceCents: null,
      entries: [],
    }),
  };
  await persistReviewAtomically({
    supabase: input.supabase,
    userId: input.userId,
    document,
    review,
    version: Number(document.processing_version ?? 1) + 1,
    extractionMethod: document.extraction_method,
  });
  return review;
}

export async function replaceInvoiceDocumentFile(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
  file: File;
}): Promise<ProcessInvoicePdfResult> {
  validateUploadedPdf(input.file);
  const buffer = Buffer.from(await input.file.arrayBuffer());
  validateBuffer(buffer);
  const { document, resolution } = await getInvoiceDocument(
    input.supabase,
    input.userId,
    input.documentId,
  );
  if (resolution.documentStatus === "confirmed") {
    throw new InvoiceImportError("CONFIRMED_DOCUMENT", "O arquivo de uma fatura confirmada não pode ser substituído.");
  }
  const fileHash = createHash("sha256").update(buffer).digest("hex");
  const duplicate = await findByHash({
    supabase: input.supabase,
    workspaceId: document.workspace_id,
    cardId: document.card_id,
    fileHash,
    excludeId: document.id,
  });
  if (duplicate) return resolveExistingInvoiceDocumentAction(duplicate);

  const replacementPath = `${document.workspace_id}/${input.userId}/credit-card-bills/replacements/${randomUUID()}.pdf`;
  const uploaded = await input.supabase.storage.from(document.storage_bucket)
    .upload(replacementPath, buffer, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "private, max-age=0",
    });
  if (uploaded.error) {
    throw new InvoiceImportError("STORAGE_UPLOAD_FAILED", "Não foi possível armazenar o novo documento.");
  }
  const updated = await input.supabase.from("invoice_documents").update({
    storage_path: replacementPath,
    original_filename: safeFilename(input.file.name),
    file_hash: fileHash,
    file_size_bytes: buffer.length,
    mime_type: "application/pdf",
    processing_status: "uploaded",
    review_status: "pending",
    processing_lock_until: null,
    parsed_payload: null,
    extracted_text: null,
    parser_name: null,
    parser_version: null,
    extraction_method: null,
    extraction_layout_version: null,
    parser_warnings: [],
    provider_future_installment_balance: null,
    next_open_invoice_amount: null,
    next_cycle_start_date: null,
    next_cycle_end_date: null,
    confidence: null,
    processing_error_code: null,
    processing_error_message: null,
  }).eq("id", document.id).eq("user_id", input.userId);
  if (updated.error) {
    await input.supabase.storage.from(document.storage_bucket).remove([replacementPath]);
    throw new InvoiceImportError("DATABASE_WRITE_FAILED", "Não foi possível substituir o documento.");
  }
  await input.supabase.storage.from(document.storage_bucket).remove([document.storage_path]);
  await acquireProcessing(input.supabase, document.id);
  const review = await processStoredBuffer({
    supabase: input.supabase,
    userId: input.userId,
    document: {
      ...document,
      storage_path: replacementPath,
      original_filename: safeFilename(input.file.name),
      file_hash: fileHash,
      file_size_bytes: buffer.length,
    },
    buffer,
    operation: "reprocess",
  });
  return { status: "processed", review };
}

export async function deleteFailedInvoiceImport(input: {
  supabase: SupabaseClient;
  userId: string;
  documentId: string;
}) {
  const result = await input.supabase.rpc("delete_failed_invoice_import", {
    p_document_id: input.documentId,
  });
  if (result.error) {
    const confirmed = /confirmed|cannot_be_deleted|depend/i.test(result.error.message);
    throw new InvoiceImportError(
      confirmed ? "CONFIRMED_DOCUMENT" : "DELETE_FAILED",
      confirmed
        ? "Esta tentativa possui dados confirmados e não pode ser excluída."
        : "Não foi possível excluir esta tentativa.",
    );
  }
  const payload = result.data as {
    storageBucket: string;
    storagePath: string;
  };
  const removed = await input.supabase.storage.from(payload.storageBucket)
    .remove([payload.storagePath]);
  return { deleted: true, storageRemoved: !removed.error };
}
