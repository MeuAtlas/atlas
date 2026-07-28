export const PDFJS_IMPORT_PATH = "pdfjs-dist/legacy/build/pdf.mjs";
export const PDFJS_VERSION = "pdfjs-dist@6.1.200";

export type PdfExtractionStage =
  | "input_conversion"
  | "pdf_validation"
  | "library_import"
  | "document_load"
  | "metadata"
  | "page_load"
  | "text_content"
  | "item_mapping"
  | "text_join"
  | "quality_assessment";

export type PdfErrorDiagnostic = {
  name: string;
  message: string;
  code: string;
  stackFirstLine: string | null;
  importPath: string;
  stage: string;
  pageNumber: number | null;
};

export type PdfStrategyDiagnostic = {
  positional: PdfErrorDiagnostic | null;
  linear: PdfErrorDiagnostic | null;
};

function errorValue(error: unknown, key: string) {
  if (!error || (typeof error !== "object" && typeof error !== "function")) {
    return undefined;
  }
  try {
    return (error as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

export function normalizePdfError(
  error: unknown,
  fallback: {
    stage: PdfExtractionStage | string;
    pageNumber?: number;
    importPath?: string;
  },
): PdfErrorDiagnostic {
  const stack = errorValue(error, "stack");
  const pageNumber = errorValue(error, "pageNumber");
  return {
    name: String(errorValue(error, "name") ?? "UnknownError"),
    message: String(errorValue(error, "message") ?? error ?? "Unknown PDF error"),
    code: String(errorValue(error, "code") ?? "UNKNOWN_PDF_ERROR"),
    stackFirstLine:
      typeof stack === "string" ? stack.split(/\r?\n/, 1)[0] || null : null,
    importPath: String(
      errorValue(error, "importPath") ?? fallback.importPath ?? PDFJS_IMPORT_PATH,
    ),
    stage: String(errorValue(error, "stage") ?? fallback.stage),
    pageNumber:
      typeof pageNumber === "number"
        ? pageNumber
        : fallback.pageNumber ?? null,
  };
}

export class PdfExtractionError extends Error {
  constructor(
    public code: string,
    message: string,
    public stage: PdfExtractionStage,
    options?: {
      cause?: unknown;
      pageNumber?: number;
      library?: string;
      importPath?: string;
      diagnostic?: PdfStrategyDiagnostic;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "PdfExtractionError";
    this.pageNumber = options?.pageNumber;
    this.library = options?.library ?? PDFJS_VERSION;
    this.importPath = options?.importPath ?? PDFJS_IMPORT_PATH;
    this.diagnostic = options?.diagnostic;
  }

  pageNumber?: number;
  library: string;
  importPath: string;
  diagnostic?: PdfStrategyDiagnostic;
}

export function normalizePdfExtractionError(
  error: unknown,
  input?: {
    stage?: PdfExtractionStage;
    inputType?: string;
    byteLength?: number;
  },
) {
  const cause =
    error && typeof error === "object" && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  const normalized = normalizePdfError(error, {
    stage: input?.stage ?? "quality_assessment",
  });
  const diagnostic =
    error instanceof PdfExtractionError ? error.diagnostic : undefined;
  return {
    ...normalized,
    causeMessage:
      cause && typeof cause === "object" && "message" in cause
        ? String((cause as { message?: unknown }).message ?? "")
        : cause == null
          ? null
          : String(cause),
    library:
      error instanceof PdfExtractionError ? error.library : PDFJS_VERSION,
    runtime: `node ${globalThis.process?.versions?.node ?? "unknown"}`,
    inputType: input?.inputType ?? "unknown",
    byteLength: input?.byteLength ?? 0,
    ...(diagnostic ?? {}),
  };
}
