import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getInvoiceReviewMetrics,
  InvoiceImportReview,
} from "@/components/finance/invoice-import-review";
import { parseInvoiceDocument } from "./parser-registry";
import { santanderExtractedFixture } from "./fixtures/santander";
import { reconcileInvoice } from "./reconciliation";
import {
  buildInvoiceImportReviewDTO,
  getInvoiceImportStepState,
  toSerializableValue,
} from "./review-dto";
import {
  resolveExistingInvoiceDocumentAction,
  type InvoiceDocumentStateRow,
} from "./existing-document";

const documentId = "11111111-1111-4111-8111-111111111111";
const cardId = "22222222-2222-4222-8222-222222222222";

const row = (parsedPayload: unknown, status = "needs_review") => {
  const state: InvoiceDocumentStateRow & {
    original_filename: string;
    parser_name: string;
    parser_version: string;
    confidence: number;
    parsed_payload: unknown;
    created_at: string;
    updated_at: string;
  } = {
    id: documentId,
    card_id: cardId,
    bill_id: null,
    processing_status: status,
    review_status: "in_review",
    confirmed_at: null,
    processing_attempts: 1,
    original_filename: "fatura-santander.pdf",
    parser_name: "santander",
    parser_version: "2.0.0",
    confidence: .94,
    parsed_payload: parsedPayload,
    created_at: "2026-07-27T12:00:00.000Z",
    updated_at: "2026-07-27T12:01:00.000Z",
  };
  return state;
};

function realReview() {
  const parsed = parseInvoiceDocument(santanderExtractedFixture);
  return {
    documentId,
    originalFilename: "fatura-santander.pdf",
    cardId,
    cardName: "Santander Mastercard",
    parsed,
    reconciliation: reconcileInvoice({
      officialTotalCents: parsed.officialTotalCents,
      previousBalanceCents: parsed.previousBalanceCents,
      entries: parsed.entries,
    }),
  };
}

test("DTO reabre a revisão Santander persistida com resumo e coleções", () => {
  const stored = row(realReview());
  const dto = buildInvoiceImportReviewDTO(
    stored,
    resolveExistingInvoiceDocumentAction(stored),
  );
  assert.equal(dto.document.id, documentId);
  assert.equal(dto.invoice?.bankName, "Santander");
  assert.equal(dto.invoice?.officialTotalCents, 150000);
  assert.ok(dto.entries.length > 0);
  assert.ok(dto.installments.length > 0);
  assert.equal(dto.inconsistent, false);
  assert.equal(dto.permissions.canConfirm, true);
});

test("revisão Santander real renderiza resumo, filtros e lista compacta", () => {
  const review = realReview();
  const html = renderToStaticMarkup(
    createElement(InvoiceImportReview, {
      review,
      onChange: () => undefined,
    }),
  );
  assert.match(html, /Revisão da fatura/);
  assert.match(html, /Dados oficiais e conciliação/);
  assert.match(html, /Lançamentos/);
  assert.match(html, /Baixa confiança/);
  assert.match(html, /Cartão final 1111/);
  assert.match(html, /9\/10/);
  assert.match(html, /Pronto para confirmar/);
  assert.doesNotMatch(html, /invoice-review-editor/);
  assert.match(html, /Santander/);
  assert.doesNotMatch(html, /^$/);
});

test("métricas da revisão refletem parcelados, avulsos e ignorados", () => {
  const review = realReview();
  review.parsed.entries[0] = {
    ...review.parsed.entries[0],
    isIgnored: true,
    reviewStatus: "ignored",
  };
  const metrics = getInvoiceReviewMetrics(review);
  assert.equal(metrics.total, review.parsed.entries.length);
  assert.equal(metrics.ignored, 1);
  assert.equal(
    metrics.installments,
    review.parsed.entries.filter(entry => !entry.isIgnored && entry.installment).length,
  );
  assert.equal(metrics.validatedTotalCents, review.parsed.officialTotalCents);
  assert.ok(metrics.averageConfidence > 0);
});

test("rascunho preserva observação, edição e estado ignorado do item", () => {
  const review = realReview();
  review.parsed.entries[0] = {
    ...review.parsed.entries[0],
    descriptionRaw: "Descrição revisada",
    descriptionNormalized: "DESCRICAO REVISADA",
    note: "Conferido no documento original",
    isIgnored: true,
    reviewStatus: "ignored",
  };
  const stored = row(review);
  const dto = buildInvoiceImportReviewDTO(
    stored,
    resolveExistingInvoiceDocumentAction(stored),
  );
  assert.equal(dto.entries[0].descriptionRaw, "Descrição revisada");
  assert.equal(dto.entries[0].note, "Conferido no documento original");
  assert.equal(dto.entries[0].isIgnored, true);
  assert.equal(dto.entries[0].reviewStatus, "ignored");
});

test("needs_review sem payload nunca vira tela vazia", () => {
  const stored = row(null);
  const dto = buildInvoiceImportReviewDTO(
    stored,
    resolveExistingInvoiceDocumentAction(stored),
  );
  assert.equal(dto.reviewState, null);
  assert.equal(dto.inconsistent, true);
  assert.deepEqual(dto.entries, []);
  assert.deepEqual(dto.installments, []);
  assert.deepEqual(dto.warnings, []);
  assert.equal(dto.permissions.canConfirm, false);
});

test("arrays nulos são normalizados pelo estado inconsistente sem lançar", () => {
  const invalid = realReview();
  (invalid.parsed as unknown as { entries: null }).entries = null;
  (invalid.parsed as unknown as { warnings: null }).warnings = null;
  const dto = buildInvoiceImportReviewDTO(
    row(invalid),
    resolveExistingInvoiceDocumentAction(row(invalid)),
  );
  assert.equal(dto.inconsistent, true);
  assert.deepEqual(dto.entries, []);
  assert.deepEqual(dto.warnings, []);
});

test("stepper mantém exatamente uma etapa atual", () => {
  for (const [status, expected] of [
    ["uploaded", "document"],
    ["failed", "processing"],
    ["processing_failed", "processing"],
    ["parsing", "processing"],
    ["needs_review", "review"],
    ["confirmed", "confirmation"],
  ]) {
    const states = getInvoiceImportStepState(status);
    assert.deepEqual(
      Object.entries(states).filter(([, value]) => value === "current").map(([key]) => key),
      [expected],
    );
  }
  assert.equal(getInvoiceImportStepState("needs_review").document, "completed");
  assert.equal(getInvoiceImportStepState("needs_review").processing, "completed");
  assert.equal(getInvoiceImportStepState("needs_review").confirmation, "upcoming");
});

test("DTO genérico serializa Date, BigInt, Decimal, Map e Set", () => {
  class Decimal {
    toString() { return "123.45"; }
  }
  assert.deepEqual(
    toSerializableValue({
      amount: new Decimal(),
      count: BigInt(4),
      at: new Date("2026-07-27T12:00:00.000Z"),
      map: new Map([["a", 1]]),
      set: new Set(["x"]),
    }),
    {
      amount: "123.45",
      count: "4",
      at: "2026-07-27T12:00:00.000Z",
      map: { a: 1 },
      set: ["x"],
    },
  );
});

test("upload e processamento sempre devolvem documentId e rota canônica", () => {
  const upload = readFileSync("src/app/api/invoice-imports/route.ts", "utf8");
  const reprocess = readFileSync(
    "src/app/api/invoice-imports/[id]/reprocess/route.ts",
    "utf8",
  );
  const flow = readFileSync(
    "src/components/finance/invoice-import-flow.tsx",
    "utf8",
  );
  assert.match(upload, /uploadInvoicePdf/);
  assert.match(upload, /\.\.\.result/);
  assert.match(upload, /nextStep:/);
  assert.match(reprocess, /processingResponseFromReview\(review\)/);
  assert.match(flow, /invoiceImportCanonicalPath\(documentId\)/);
  assert.doesNotMatch(flow, /importar-fatura\?documentId=/);
});

test("acesso direto e refresh carregam pelo banco sem engolir RLS", () => {
  const page = readFileSync(
    "src/app/financeiro/cartoes/importar-fatura/[documentId]/page.tsx",
    "utf8",
  );
  const service = readFileSync(
    "src/modules/finance/invoice-import/review-service.ts",
    "utf8",
  );
  const legacyPage = readFileSync(
    "src/app/financeiro/cartoes/importar-fatura/page.tsx",
    "utf8",
  );
  assert.match(page, /getInvoiceImportReview\(supabase, user\.id, documentId\)/);
  assert.match(service, /\.eq\("user_id", userId\)/);
  assert.match(service, /card\.data\.workspace_id !== row\.workspace_id/);
  assert.match(service, /INVOICE_REVIEW_QUERY_FAILED/);
  assert.doesNotMatch(legacyPage, /\.catch\(\(\) => null\)/);
  assert.match(legacyPage, /redirect\(invoiceImportCanonicalPath\(requestedDocument\)\)/);
});

test("revisão possui erro, loading, vazios úteis, retry e persistência de rascunho", () => {
  const flow = readFileSync(
    "src/components/finance/invoice-import-flow.tsx",
    "utf8",
  );
  const review = readFileSync(
    "src/components/finance/invoice-import-review.tsx",
    "utf8",
  );
  const error = readFileSync(
    "src/app/financeiro/cartoes/importar-fatura/error.tsx",
    "utf8",
  );
  const loading = readFileSync(
    "src/app/financeiro/cartoes/importar-fatura/loading.tsx",
    "utf8",
  );
  assert.match(flow, /A revisão desta importação não foi preparada corretamente/);
  assert.match(flow, /method: "PATCH"/);
  assert.match(flow, /Reprocessar/);
  assert.match(flow, /invoice-review-footer-summary/);
  assert.match(flow, /Confirmar importação/);
  assert.match(review, /Nenhum lançamento foi identificado automaticamente/);
  assert.match(review, /Nenhum lançamento corresponde aos filtros/);
  assert.match(review, /const warnings = review\.parsed\.warnings \?\? \[\]/);
  assert.match(review, /setExpandedId\(current => current === entry\.id \? null : entry\.id\)/);
  assert.match(review, /Cancelar edição/);
  assert.match(review, /Salvar item/);
  assert.match(error, /Seus dados não foram apagados/);
  assert.match(loading, /skeletonType="invoice-review"/);
});

test("layout compacto cobre desktop, mobile, filtros e rodapé sticky", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.invoice-review-list-head,.invoice-review-row-main\{display:grid/);
  assert.match(css, /\.invoice-review-actions\{[\s\S]*bottom:12px/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*\.invoice-review-metrics\{grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:700px\)\{[\s\S]*\.invoice-review-editor-grid\{grid-template-columns:1fr 1fr/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("migration persiste payload e versão antes de needs_review e recupera órfãos", () => {
  const sql = readFileSync(
    "supabase/migrations/202607280033_reliable_invoice_import_review.sql",
    "utf8",
  );
  assert.match(sql, /persist_invoice_import_review/);
  assert.match(sql, /jsonb_typeof\(parsed->'entries'\) <> 'array'/);
  assert.match(sql, /insert into public\.invoice_processing_versions/);
  assert.match(sql, /processing_status='needs_review'/);
  assert.match(sql, /INCOMPLETE_REVIEW_PAYLOAD/);
  assert.match(sql, /where processing_status in \('needs_review','parsed'\)/);
});

test("reprocessamento e confirmação invalidam a rota identificada", () => {
  const reprocess = readFileSync(
    "src/app/api/invoice-imports/[id]/reprocess/route.ts",
    "utf8",
  );
  const documentRoute = readFileSync(
    "src/app/api/invoice-imports/[id]/route.ts",
    "utf8",
  );
  assert.match(reprocess, /revalidatePath\(`\/financeiro\/cartoes\/importar-fatura\/\$\{id\}`\)/);
  assert.match(documentRoute, /saveInvoiceReviewDraft/);
  assert.match(documentRoute, /revalidatePath\(`\/financeiro\/cartoes\/importar-fatura\/\$\{id\}`\)/);
});
