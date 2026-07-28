import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  resolveExistingInvoiceDocumentAction,
  type InvoiceDocumentStateRow,
} from "./existing-document";

const row = (
  overrides: Partial<InvoiceDocumentStateRow> = {},
): InvoiceDocumentStateRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  card_id: "22222222-2222-4222-8222-222222222222",
  bill_id: null,
  processing_status: "uploaded",
  review_status: "pending",
  confirmed_at: null,
  processing_attempts: 1,
  ...overrides,
});

test("confirmed bloqueia nova importação e abre a fatura", () => {
  const result = resolveExistingInvoiceDocumentAction(row({
    processing_status: "confirmed",
    bill_id: "33333333-3333-4333-8333-333333333333",
  }));
  assert.equal(result.documentStatus, "confirmed");
  assert.equal(result.action, "open_bill");
  assert.equal(result.canDelete, false);
  assert.match(result.message, /confirmada/);
});

test("approved ou confirmed_at também são confirmação definitiva", () => {
  assert.equal(resolveExistingInvoiceDocumentAction(row({
    review_status: "approved",
  })).action, "open_bill");
  assert.equal(resolveExistingInvoiceDocumentAction(row({
    confirmed_at: "2026-07-28T12:00:00Z",
  })).action, "open_bill");
});

test("needs_review e parsed continuam a revisão existente", () => {
  for (const status of ["needs_review", "parsed", "extracted"]) {
    const result = resolveExistingInvoiceDocumentAction(row({
      processing_status: status,
      review_status: "in_review",
    }));
    assert.equal(result.documentStatus, "needs_review");
    assert.equal(result.action, "continue_review");
  }
});

test("failed permite retry, substituição e exclusão", () => {
  const result = resolveExistingInvoiceDocumentAction(row({
    processing_status: "failed",
    processing_error_code: "TEXT_EXTRACTION_FAILED",
  }));
  assert.equal(result.action, "retry");
  assert.equal(result.canReplace, true);
  assert.equal(result.canDelete, true);
  assert.equal(result.errorCode, "TEXT_EXTRACTION_FAILED");
});

test("uploaded continua processamento sem criar documento novo", () => {
  const result = resolveExistingInvoiceDocumentAction(row());
  assert.equal(result.documentStatus, "uploaded");
  assert.equal(result.action, "continue_processing");
});

test("lock ativo aguarda e lock expirado permite recuperação", () => {
  const now = new Date("2026-07-28T12:00:00Z");
  const active = resolveExistingInvoiceDocumentAction(row({
    processing_status: "extracting",
    processing_lock_until: "2026-07-28T12:05:00Z",
  }), now);
  assert.equal(active.action, "wait");
  assert.equal(active.canDelete, false);
  const expired = resolveExistingInvoiceDocumentAction(row({
    processing_status: "extracting",
    processing_lock_until: "2026-07-28T11:59:59Z",
  }), now);
  assert.equal(expired.action, "retry");
});

test("terceira falha oferece preenchimento manual sem bloquear", () => {
  const result = resolveExistingInvoiceDocumentAction(row({
    processing_status: "failed",
    processing_attempts: 3,
  }));
  assert.equal(result.action, "retry");
  assert.match(result.message, /preencher os dados manualmente/);
});

test("migration 031 cria lock, contador, recuperação e hash ativo", () => {
  const sql = readFileSync(
    "supabase/migrations/202607280031_recover_failed_invoice_imports.sql",
    "utf8",
  );
  assert.match(sql, /processing_attempts integer not null default 0/);
  assert.match(sql, /processing_lock_until timestamptz/);
  assert.match(sql, /create unique index invoice_documents_active_file_hash/);
  assert.match(sql, /where deleted_at is null/);
  assert.match(sql, /acquire_invoice_document_processing/);
  assert.match(sql, /processing_lock_until is null or processing_lock_until<=now\(\)/);
  assert.match(sql, /delete_failed_invoice_import/);
  assert.match(sql, /confirmed_invoice_document_cannot_be_deleted/);
});

test("frontend usa rota recuperável e botões não submetem formulário", () => {
  const source = readFileSync(
    "src/components/finance/invoice-import-flow.tsx",
    "utf8",
  );
  assert.match(source, /invoiceImportCanonicalPath\(existing\.documentId\)/);
  assert.match(source, /\/reprocess`/);
  assert.match(source, /\/replace`/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /type="button" className="finance-button" onClick=\{retry\}/);
});

test("API retorna existing tipado em vez de duplicate genérico", () => {
  const route = readFileSync("src/app/api/invoice-imports/route.ts", "utf8");
  const documentRoute = readFileSync(
    "src/app/api/invoice-imports/[id]/route.ts",
    "utf8",
  );
  const resolver = readFileSync(
    "src/modules/finance/invoice-import/existing-document.ts",
    "utf8",
  );
  assert.match(route, /uploadInvoicePdf/);
  assert.match(route, /nextStep:/);
  assert.doesNotMatch(route, /duplicate_pdf/);
  assert.match(resolver, /status: "existing"/);
  assert.match(resolver, /documentId/);
  assert.match(resolver, /documentStatus/);
  assert.match(resolver, /action/);
  assert.doesNotMatch(documentRoute, /storage_path: document\.storage_path/);
  assert.doesNotMatch(documentRoute, /extracted_text: document\.extracted_text/);
  assert.doesNotMatch(documentRoute, /file_hash: document\.file_hash/);
});

test("replace envia o novo arquivo antes de remover o antigo", () => {
  const source = readFileSync(
    "src/modules/finance/invoice-import/repository.ts",
    "utf8",
  );
  const upload = source.indexOf(".upload(replacementPath");
  const databaseUpdate = source.indexOf("storage_path: replacementPath", upload);
  const oldRemoval = source.indexOf("remove([document.storage_path])", databaseUpdate);
  assert.ok(upload >= 0 && databaseUpdate > upload && oldRemoval > databaseUpdate);
});
