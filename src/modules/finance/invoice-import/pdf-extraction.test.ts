import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assessExtractedTextQuality,
  extractPdfText,
  normalizePdfExtractionError,
  PdfExtractionError,
  toPdfUint8Array,
  validatePdfBytes,
} from "./extract-pdf";
import type { ExtractedPdfDocument } from "./types";

const pdfBytes = () => new Uint8Array(Buffer.from("%PDF-1.4\nfixture"));

test("normaliza Blob, Buffer com offset, ArrayBuffer e Uint8Array em cópias", async () => {
  const blob = await toPdfUint8Array(new Blob([pdfBytes()], { type: "application/pdf" }));
  assert.equal(String.fromCharCode(...blob.subarray(0, 5)), "%PDF-");

  const parent = Buffer.concat([Buffer.from("xx"), Buffer.from("%PDF-1.4"), Buffer.from("yy")]);
  const offset = parent.subarray(2, parent.length - 2);
  const fromBuffer = await toPdfUint8Array(offset);
  assert.equal(Buffer.from(fromBuffer).toString("ascii"), "%PDF-1.4");

  const arrayBuffer = pdfBytes().buffer.slice(0);
  const fromArrayBuffer = await toPdfUint8Array(arrayBuffer);
  const original = new Uint8Array(pdfBytes());
  const copied = await toPdfUint8Array(original);
  original[0] = 0;
  assert.equal(fromArrayBuffer[0], 37);
  assert.equal(copied[0], 37);
});

test("valida cabeçalho, arquivo vazio e arquivo corrompido", () => {
  assert.doesNotThrow(() => validatePdfBytes(pdfBytes()));
  assert.throws(() => validatePdfBytes(new Uint8Array()), /vazio/);
  assert.throws(() => validatePdfBytes(new Uint8Array(Buffer.from("arquivo"))), /cabeçalho/);
});

test("qualidade só classifica image-only após extração técnica sem texto", () => {
  const empty = assessExtractedTextQuality([
    { items: [], text: "", plainText: "" },
    { items: [], text: "", plainText: "" },
  ]);
  assert.equal(empty.likelyImageOnly, true);
  const text = assessExtractedTextQuality([
    {
      items: [{
        pageNumber: 1, text: "Santander", x: 1, y: 1,
        width: 1, height: 1, visualIndex: 0,
      }],
      text: "Santander Resumo da Fatura",
      plainText: "Santander Resumo da Fatura",
    },
  ]);
  assert.equal(text.likelyImageOnly, false);
  assert.ok(text.knownMarkersFound.includes("SANTANDER"));
});

const fallbackDocument: ExtractedPdfDocument = {
  pageCount: 1,
  pages: [{
    pageNumber: 1,
    width: 100,
    height: 100,
    text: "Santander",
    plainText: "Santander",
    lines: ["Santander"],
    items: [],
    visualLines: [],
  }],
  fullText: "Santander",
  metadata: {},
  extractionWarnings: ["fallback"],
  extractionMethod: "linear_fallback",
  extractorVersion: "test",
  quality: {
    characterCount: 9,
    nonWhitespaceCharacterCount: 9,
    pagesWithText: 1,
    knownMarkersFound: ["SANTANDER"],
    confidence: 0.5,
    likelyImageOnly: false,
  },
};

test("falha principal usa fallback linear e ambas as falhas preservam a causa", async () => {
  const recovered = await extractPdfText(pdfBytes(), {
    primary: async () => {
      throw new Error("primary failed");
    },
    fallback: async () => fallbackDocument,
  });
  assert.equal(recovered.extractionMethod, "linear_fallback");

  await assert.rejects(
    extractPdfText(pdfBytes(), {
      primary: async () => {
        throw new Error("primary failed");
      },
      fallback: async () => {
        throw new Error("fallback failed");
      },
    }),
    error => {
      assert.ok(error instanceof PdfExtractionError);
      assert.equal(error.code, "TEXT_EXTRACTION_FAILED");
      const normalized = normalizePdfExtractionError(error, {
        inputType: "Uint8Array",
        byteLength: pdfBytes().byteLength,
      });
      assert.equal(normalized.stage, "text_join");
      assert.notEqual(normalized.message, "");
      assert.equal(normalized.positional?.message, "primary failed");
      assert.equal(normalized.positional?.stage, "item_mapping");
      assert.equal(normalized.linear?.message, "fallback failed");
      assert.equal(normalized.linear?.stage, "text_join");
      assert.equal(
        normalized.positional?.importPath,
        "pdfjs-dist/legacy/build/pdf.mjs",
      );
      return true;
    },
  );
});

test("falha dentro da página preserva o número e a etapa reais", async () => {
  await assert.rejects(
    extractPdfText(pdfBytes(), {
      primary: async () => {
        throw new PdfExtractionError(
          "PDF_PAGE_TEXT_FAILED",
          "page failed",
          "text_content",
          { pageNumber: 3 },
        );
      },
    }),
    error => {
      assert.ok(error instanceof PdfExtractionError);
      assert.equal(error.code, "PDF_PAGE_TEXT_FAILED");
      assert.equal(error.pageNumber, 3);
      assert.equal(error.stage, "text_content");
      return true;
    },
  );
});

test("pipeline de reprocessamento valida Storage, hash e runtime Node", () => {
  const repository = readFileSync(
    "src/modules/finance/invoice-import/repository.ts",
    "utf8",
  );
  const route = readFileSync(
    "src/app/api/invoice-imports/[id]/reprocess/route.ts",
    "utf8",
  );
  assert.match(repository, /downloadInvoicePdfBytes/);
  assert.match(repository, /instanceof Blob/);
  assert.match(repository, /createHash\("sha256"\)/);
  assert.match(repository, /PDF_HASH_MISMATCH/);
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /STORAGE_FILE_MISSING/);
  assert.match(route, /return 500/);
  assert.match(route, /EMPTY_EXTRACTED_TEXT/);
  const migration = readFileSync(
    "supabase/migrations/202607280034_reliable_pdf_text_extraction.sql",
    "utf8",
  );
  assert.match(migration, /extractor_version text/);
  assert.match(migration, /page_count integer/);
  assert.match(migration, /extracted_character_count integer/);
});

test("runtime oficial e bundling mantêm PDF.js legacy no servidor", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const nextConfig = readFileSync("next.config.ts", "utf8");
  const adapter = readFileSync(
    "src/modules/finance/invoice-import/pdf/pdfjs-node.ts",
    "utf8",
  );
  const script = readFileSync("scripts/test-pdf-extraction.mjs", "utf8");
  assert.equal(readFileSync(".nvmrc", "utf8").trim(), "22");
  assert.equal(packageJson.engines.node, "22.x");
  assert.match(nextConfig, /serverExternalPackages: \["pdfjs-dist"\]/);
  assert.match(adapter, /import\("pdfjs-dist\/legacy\/build\/pdf\.mjs"\)/);
  assert.doesNotMatch(adapter, /GlobalWorkerOptions|pdf\.worker|workerSrc/);
  assert.match(script, /getTextContent\(\)/);
  assert.match(script, /pageCount/);
});
