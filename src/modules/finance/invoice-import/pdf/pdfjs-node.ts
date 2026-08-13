import { normalizeInvoiceText } from "../normalize-text";
import type {
  ExtractedPdfDocument,
  ExtractedPdfPage,
  PdfTextItem,
} from "../types";
import { buildVisualLines } from "../visual-layout";
import {
  normalizePdfError,
  PDFJS_IMPORT_PATH,
  PDFJS_VERSION,
  PdfExtractionError,
  type PdfErrorDiagnostic,
} from "./pdf-errors";

const KNOWN_MARKERS = [
  "SANTANDER",
  "DETALHAMENTO DA FATURA",
  "RESUMO DA FATURA",
  "SALDO DESTA FATURA",
  "VENCIMENTO",
  "PARCELAMENTOS",
];

type PdfJsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfJsTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

function isPdfJsTextItem(value: unknown): value is PdfJsTextItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PdfJsTextItem>;
  return (
    typeof item.str === "string" &&
    Array.isArray(item.transform) &&
    item.transform.length >= 6 &&
    item.transform.every(coordinate => Number.isFinite(Number(coordinate))) &&
    Number.isFinite(Number(item.width)) &&
    Number.isFinite(Number(item.height))
  );
}

export function assessExtractedTextQuality(
  pages: Array<{ items: PdfTextItem[]; plainText?: string; text: string }>,
) {
  const fullText = pages.map(page => page.plainText ?? page.text).join("\n\n");
  const upper = fullText.toLocaleUpperCase("pt-BR");
  const characterCount = fullText.length;
  const nonWhitespaceCharacterCount = fullText.replace(/\s/g, "").length;
  const pagesWithText = pages.filter(
    page =>
      page.items.some(item => item.text.trim()) &&
      (page.plainText ?? page.text).replace(/\s/g, "").length >= 3,
  ).length;
  const knownMarkersFound = KNOWN_MARKERS.filter(marker => upper.includes(marker));
  const likelyImageOnly =
    pagesWithText === 0 &&
    nonWhitespaceCharacterCount < 20 &&
    pages.every(page => page.items.length < 3);
  const confidence = Math.min(
    1,
    (pagesWithText / Math.max(1, pages.length)) * 0.55 +
      Math.min(0.3, nonWhitespaceCharacterCount / 3000) +
      Math.min(0.15, knownMarkersFound.length * 0.03),
  );
  return {
    characterCount,
    nonWhitespaceCharacterCount,
    pagesWithText,
    knownMarkersFound,
    markersFound: knownMarkersFound,
    confidence,
    likelyImageOnly,
  };
}

async function loadPdfJs(): Promise<PdfJsModule> {
  try {
    // Next.js resolves this marker only in its server compilation. Keeping it
    // conditional lets the same adapter run in the isolated Node test.
    if (process.env.NEXT_RUNTIME) await import("server-only");
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    throw new PdfExtractionError(
      "PDF_LIBRARY_LOAD_FAILED",
      "A biblioteca de PDF não pôde ser carregada.",
      "library_import",
      { cause: error, importPath: PDFJS_IMPORT_PATH },
    );
  }
}

async function loadDocument(pdfjs: PdfJsModule, bytes: Uint8Array) {
  try {
    return await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    const normalized = normalizePdfError(error, {
      stage: "document_load",
      importPath: PDFJS_IMPORT_PATH,
    });
    if (/password/i.test(`${normalized.name} ${normalized.message}`)) {
      throw new PdfExtractionError(
        "PASSWORD_PROTECTED",
        "Este PDF está protegido por senha.",
        "document_load",
        { cause: error },
      );
    }
    throw new PdfExtractionError(
      "PDF_DOCUMENT_LOAD_FAILED",
      "O documento PDF não pôde ser carregado.",
      "document_load",
      { cause: error },
    );
  }
}

function mapTextItems(rawItems: unknown[], pageNumber: number, viewport: { transform: number[] }, pdfjs: PdfJsModule): PdfTextItem[] {
  try {
    return rawItems
      .filter(isPdfJsTextItem)
      .map((item, index) => {
        const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
        return {
          pageNumber, index, text: normalizeInvoiceText(item.str),
          x: Number(transformed[4]), y: Number(transformed[5]),
          width: Number(item.width), height: Number(item.height || Math.abs(item.transform[3])),
          rawX: Number(item.transform[4]), rawY: Number(item.transform[5]),
          hasEOL: Boolean(item.hasEOL), visualIndex: index,
        };
      })
      .filter(item => item.text);
  } catch (error) {
    throw new PdfExtractionError(
      "PDF_PAGE_ITEM_MAPPING_FAILED",
      `Os itens de texto da página ${pageNumber} não puderam ser mapeados.`,
      "item_mapping",
      { cause: error, pageNumber },
    );
  }
}

function joinLinearText(items: PdfTextItem[]) {
  return items
    .map(item => `${item.text}${item.hasEOL ? "\n" : " "}`)
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractPageText(input: {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTextItem[];
}) {
  let positionalError: PdfErrorDiagnostic | null = null;
  let linearError: PdfErrorDiagnostic | null = null;
  let visualLines: ExtractedPdfPage["visualLines"] = [];
  let plainText = "";

  try {
    visualLines = buildVisualLines({
      items: input.items,
      pageWidth: input.width,
      pageHeight: input.height,
    });
  } catch (error) {
    positionalError = normalizePdfError(error, {
      stage: "item_mapping",
      pageNumber: input.pageNumber,
    });
  }

  try {
    plainText = joinLinearText(input.items);
  } catch (error) {
    linearError = normalizePdfError(error, {
      stage: "text_join",
      pageNumber: input.pageNumber,
    });
  }

  if (positionalError && linearError) {
    throw new PdfExtractionError(
      "TEXT_EXTRACTION_FAILED",
      `As estratégias de organização da página ${input.pageNumber} falharam.`,
      "text_join",
      {
        pageNumber: input.pageNumber,
        cause: { positional: positionalError, linear: linearError },
        diagnostic: { positional: positionalError, linear: linearError },
      },
    );
  }

  const lines = positionalError
    ? plainText.split(/\r?\n/).filter(Boolean)
    : visualLines.map(line => line.text);
  return {
    lines,
    visualLines,
    plainText,
    text: lines.join("\n") || plainText,
    usedLinearFallback: Boolean(positionalError),
    positionalError,
    linearError,
  };
}

export async function extractPdfWithPdfJs(
  bytes: Uint8Array,
): Promise<ExtractedPdfDocument> {
  const pdfjs = await loadPdfJs();
  const pdf = await loadDocument(pdfjs, bytes);
  const pages: ExtractedPdfDocument["pages"] = [];
  const warnings: string[] = [];
  let usedLinearFallback = false;

  try {
    await pdf.getMetadata();
  } catch (error) {
    const metadataError = normalizePdfError(error, { stage: "metadata" });
    warnings.push(`Metadados indisponíveis (${metadataError.code}).`);
  }

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    let page;
    try {
      page = await pdf.getPage(pageNumber);
    } catch (error) {
      throw new PdfExtractionError(
        "PDF_PAGE_LOAD_FAILED",
        `A página ${pageNumber} não pôde ser carregada.`,
        "page_load",
        { cause: error, pageNumber },
      );
    }

    let content;
    try {
      content = await page.getTextContent();
    } catch (error) {
      throw new PdfExtractionError(
        "PDF_PAGE_TEXT_FAILED",
        `A camada de texto da página ${pageNumber} não pôde ser lida.`,
        "text_content",
        { cause: error, pageNumber },
      );
    }

    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const items = mapTextItems(content.items, pageNumber, viewport, pdfjs);
    const extracted = extractPageText({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      items,
    });
    usedLinearFallback ||= extracted.usedLinearFallback;
    if (extracted.positionalError) {
      warnings.push(
        `Página ${pageNumber}: layout posicional indisponível; texto linear utilizado.`,
      );
    }
    pages.push({
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      text: extracted.text,
      plainText: extracted.plainText,
      lines: extracted.lines,
      items,
      visualLines: extracted.visualLines,
    });
  }

  const quality = assessExtractedTextQuality(pages);
  const fullText = pages.map(page => page.text || page.plainText || "").join("\n\n");
  if (quality.likelyImageOnly) {
    throw new PdfExtractionError(
      "EMPTY_EXTRACTED_TEXT",
      "O PDF foi lido, mas não possui texto pesquisável suficiente.",
      "quality_assessment",
    );
  }
  return {
    pageCount: pdf.numPages,
    pages,
    fullText,
    itemCount: pages.reduce((count, page) => count + page.items.length, 0),
    characterCount: quality.characterCount,
    metadata: {},
    extractionWarnings: warnings,
    warnings,
    extractionMethod: usedLinearFallback
      ? "linear_fallback"
      : "pdfjs_legacy",
    extractorVersion: PDFJS_VERSION,
    quality,
  };
}
