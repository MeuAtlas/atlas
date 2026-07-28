import type { ExtractedPdfDocument } from "./types";
import {
  normalizePdfError,
  normalizePdfExtractionError,
  PDFJS_IMPORT_PATH,
  PdfExtractionError,
  type PdfExtractionStage,
} from "./pdf/pdf-errors";
import {
  assessExtractedTextQuality,
  extractPdfWithPdfJs,
} from "./pdf/pdfjs-node";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export {
  assessExtractedTextQuality,
  extractPdfWithPdfJs,
  normalizePdfExtractionError,
  PdfExtractionError,
};
export type { PdfExtractionStage };

export type PdfBinaryInput = Buffer | ArrayBuffer | Uint8Array | Blob;

export async function toPdfUint8Array(input: PdfBinaryInput): Promise<Uint8Array> {
  try {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(input)) {
      return new Uint8Array(
        input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength),
      );
    }
    if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
    if (input instanceof Uint8Array) return new Uint8Array(input);
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      return new Uint8Array(await input.arrayBuffer());
    }
  } catch (error) {
    throw new PdfExtractionError(
      "PDF_INPUT_CONVERSION_FAILED",
      "Não foi possível converter o PDF para bytes.",
      "input_conversion",
      { cause: error },
    );
  }
  throw new PdfExtractionError(
    "PDF_INPUT_CONVERSION_FAILED",
    "O formato binário recebido não é compatível.",
    "input_conversion",
  );
}

export function validatePdfBytes(bytes: Uint8Array) {
  if (!bytes.byteLength) {
    throw new PdfExtractionError(
      "INVALID_PDF",
      "O arquivo PDF está vazio.",
      "pdf_validation",
    );
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfExtractionError(
      "PDF_TOO_LARGE",
      "O PDF excede 20 MB.",
      "pdf_validation",
    );
  }
  const signature = String.fromCharCode(...bytes.subarray(0, 5));
  if (signature !== "%PDF-") {
    throw new PdfExtractionError(
      "INVALID_PDF",
      "O arquivo não possui um cabeçalho PDF válido.",
      "pdf_validation",
    );
  }
}

export function validatePdfBuffer(buffer: Buffer | Uint8Array) {
  validatePdfBytes(new Uint8Array(buffer));
}

export type PdfExtractionStrategy = (
  bytes: Uint8Array,
) => Promise<ExtractedPdfDocument>;

export async function extractPdfText(
  input: PdfBinaryInput,
  strategies?: {
    primary?: PdfExtractionStrategy;
    fallback?: PdfExtractionStrategy;
  },
): Promise<ExtractedPdfDocument> {
  const bytes = await toPdfUint8Array(input);
  validatePdfBytes(bytes);

  if (!strategies) {
    return extractPdfWithPdfJs(new Uint8Array(bytes));
  }

  const primary = strategies.primary ?? extractPdfWithPdfJs;
  let positionalError: unknown;
  try {
    return await primary(new Uint8Array(bytes));
  } catch (error) {
    if (
      error instanceof PdfExtractionError &&
      ["PASSWORD_PROTECTED", "INVALID_PDF"].includes(error.code)
    ) {
      throw error;
    }
    positionalError = error;
  }

  if (!strategies.fallback) {
    throw positionalError;
  }

  try {
    return await strategies.fallback(new Uint8Array(bytes));
  } catch (linearFailure) {
    const positional = normalizePdfError(positionalError, {
      stage: "item_mapping",
      importPath: PDFJS_IMPORT_PATH,
    });
    const linear = normalizePdfError(linearFailure, {
      stage: "text_join",
      importPath: PDFJS_IMPORT_PATH,
    });
    throw new PdfExtractionError(
      "TEXT_EXTRACTION_FAILED",
      "As estratégias posicional e linear falharam.",
      "text_join",
      {
        cause: { positional, linear },
        diagnostic: { positional, linear },
      },
    );
  }
}
