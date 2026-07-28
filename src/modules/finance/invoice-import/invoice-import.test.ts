import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildInstallmentFingerprint, scoreInstallmentMatch } from "./fingerprint";
import { extractPdfText, validatePdfBuffer } from "./extract-pdf";
import { parseInstallmentDescriptor } from "./installment-parser";
import { parseBrazilianMoney } from "./money";
import { parseInvoiceDocument } from "./parser-registry";
import { projectInstallmentOccurrences, calculateFutureCardCommitments } from "./projections";
import { reconcileInvoice } from "./reconciliation";
import { santanderExtractedFixture, imageOnlyFixture } from "./fixtures/santander";
import type { ParsedInvoiceEntry } from "./types";
import {
  groupTextItemsIntoVisualLines,
  isDecorativeTransactionGlyph,
  splitPageIntoColumns,
} from "./visual-layout";

test("converte total brasileiro e valor negativo em centavos", () => {
  assert.equal(parseBrazilianMoney("R$ 1.234,56"), 123456);
  assert.equal(parseBrazilianMoney("-1.234,56"), -123456);
  assert.equal(parseBrazilianMoney("sem valor"), null);
});

function syntheticPdf(text: string) {
  const stream = `BT /F1 12 Tf 40 100 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

test("valida assinatura e extrai texto de PDF sintético anonimizado", async () => {
  assert.throws(
    () => validatePdfBuffer(Buffer.from("arquivo")),
    error => error instanceof Error && "code" in error &&
      (error as Error & { code: string }).code === "INVALID_PDF",
  );
  const extracted = await extractPdfText(syntheticPdf("SANTANDER FATURA TESTE"));
  assert.equal(extracted.pageCount, 1);
  assert.match(extracted.fullText, /SANTANDER FATURA TESTE/);
  assert.equal(extracted.extractionMethod, "pdfjs_legacy");
  assert.ok(extracted.pages[0].items[0].x >= 0);
  assert.ok(extracted.pages[0].visualLines.length > 0);
});

test("reconhece formatos de parcela suportados", () => {
  for (const value of ["PARC 03/10", "PARCELA 3 DE 10", "03 DE 10", "03-10", "03X10", "P03/10"]) {
    assert.deepEqual(parseInstallmentDescriptor(value, { hasMoney: true, hasMerchant: true })?.current, 3);
    assert.deepEqual(parseInstallmentDescriptor(value, { hasMoney: true, hasMerchant: true })?.total, 10);
  }
});

test("não confunde data, horário nem final de cartão com parcela", () => {
  assert.equal(parseInstallmentDescriptor("03/07"), null);
  assert.equal(parseInstallmentDescriptor("CARTAO FINAL 0310"), null);
  assert.equal(parseInstallmentDescriptor("HORARIO 03:10"), null);
});

test("parser Santander reconhece resumo, linhas quebradas e tipos", () => {
  const parsed = parseInvoiceDocument(santanderExtractedFixture, { referenceYear: 2026 });
  assert.equal(parsed.bankCode, "033");
  assert.equal(parsed.parserVersion, "2.0.0");
  assert.equal(parsed.pageCount, 4);
  assert.equal(parsed.officialTotalCents, 150000);
  assert.equal(parsed.dueDate, "2026-07-10");
  assert.equal(parsed.closingDate, "2026-07-03");
  assert.equal(parsed.cycleStartDate, "2026-06-03");
  assert.equal(parsed.cardLastFour, "1111");
  const installment = parsed.entries.find(entry => entry.installment);
  assert.equal(installment?.installment?.current, 9);
  assert.equal(installment?.installment?.total, 10);
  assert.match(installment?.descriptionRaw ?? "", /MERCHANT A/);
  assert.ok(parsed.entries.some(entry => entry.entryType === "payment"));
  assert.ok(parsed.entries.some(entry => entry.entryType === "tax"));
  assert.ok(parsed.entries.some(entry => entry.entryType === "fee"));
  assert.equal(parsed.cardSections?.length, 2);
  assert.deepEqual(parsed.cardSections?.map(section => section.cardLastFour), ["1111", "2222"]);
  assert.equal(parsed.cardSections?.[0].subtotalBRLCents, 90000);
  assert.equal(parsed.cardSections?.[1].subtotalBRLCents, 60000);
  assert.equal(parsed.santanderSummary?.finalBalanceCents, 150000);
  assert.equal(parsed.providerFutureInstallmentBalanceCents, 39418);
  assert.equal(parsed.validation?.officialTotalMatchesSummary, true);
  assert.equal(parsed.validation?.cardSubtotalsMatchOfficialTotal, true);
  assert.equal(parsed.validation?.futureProjectionMatchesProviderBalance, true);
});

test("layout separa duas colunas sem misturar linhas", () => {
  const items = [
    { pageNumber: 2, text: "03/07 MERCHANT A", x: 30, y: 400, width: 80, height: 7, visualIndex: 0 },
    { pageNumber: 2, text: "10,00", x: 210, y: 400, width: 20, height: 7, visualIndex: 1 },
    { pageNumber: 2, text: "03/07 MERCHANT B", x: 330, y: 400, width: 80, height: 7, visualIndex: 2 },
    { pageNumber: 2, text: "20,00", x: 505, y: 400, width: 20, height: 7, visualIndex: 3 },
    ...Array.from({ length: 12 }, (_, index) => ({
      pageNumber: 2,
      text: `L${index}`,
      x: 30,
      y: 380 - index * 10,
      width: 10,
      height: 7,
      visualIndex: index + 4,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      pageNumber: 2,
      text: `R${index}`,
      x: 330,
      y: 380 - index * 10,
      width: 10,
      height: 7,
      visualIndex: index + 16,
    })),
  ];
  const columns = splitPageIntoColumns({ items, pageWidth: 595, pageHeight: 842 });
  assert.equal(columns.length, 2);
  const left = groupTextItemsIntoVisualLines(columns[0], { columnIndex: 0 });
  const right = groupTextItemsIntoVisualLines(columns[1], { columnIndex: 1 });
  assert.match(left.find(line => line.y === 400)?.text ?? "", /MERCHANT A/);
  assert.doesNotMatch(left.find(line => line.y === 400)?.text ?? "", /MERCHANT B/);
  assert.match(right.find(line => line.y === 400)?.text ?? "", /MERCHANT B/);
});

test("glifos decorativos são ignorados e 99 RIDE é preservado", () => {
  assert.equal(isDecorativeTransactionGlyph("3"), true);
  assert.equal(isDecorativeTransactionGlyph("@"), true);
  assert.equal(isDecorativeTransactionGlyph("99 RIDE"), false);
  const parsed = parseInvoiceDocument(santanderExtractedFixture);
  assert.ok(parsed.entries.some(entry => entry.descriptionRaw === "99 RIDE"));
  assert.ok(parsed.entries.every(entry => !/^[23@]$/.test(entry.descriptionRaw)));
});

test("data e parcela iguais usam as colunas visuais", () => {
  const parsed = parseInvoiceDocument(santanderExtractedFixture);
  const entry = parsed.entries.find(item => item.descriptionRaw === "MERCHANT A");
  assert.equal(entry?.transactionDate, "2025-10-09");
  assert.equal(entry?.installment?.current, 9);
  assert.equal(entry?.installment?.total, 10);
});

test("cartão continua na página seguinte e dados internacionais são associados", () => {
  const parsed = parseInvoiceDocument(santanderExtractedFixture);
  const continued = parsed.entries.find(entry => entry.descriptionRaw === "MERCHANT C");
  assert.equal(continued?.cardLastFour, "2222");
  assert.equal(continued?.installment?.current, 2);
  const international = parsed.entries.find(entry => entry.descriptionRaw === "INTERNATIONAL SHOP");
  assert.equal(international?.foreignAmountCents, 10000);
  assert.equal(international?.foreignCurrencyCode, "USD");
  assert.equal(international?.exchangeRate, 4.2);
  assert.equal(international?.iofAmountCents, 1000);
  const iof = parsed.entries.find(entry =>
    entry.entryType === "tax" &&
    entry.relatedForeignEntryId === international?.id);
  assert.ok(iof);
});

test("página de CET não vira lançamento", () => {
  const parsed = parseInvoiceDocument(santanderExtractedFixture);
  assert.ok(parsed.entries.every(entry => !/CUSTO EFETIVO|JUROS E/.test(entry.descriptionRaw)));
});

test("parser genérico não inventa campos ausentes", () => {
  const lines = ["FATURA", "VENCIMENTO 20/08/2026", "01/08 PADARIA 25,90"];
  const parsed = parseInvoiceDocument({
    pageCount: 1, pages: [{
      pageNumber: 1, width: 595, height: 842, lines, text: lines.join("\n"),
      items: [], visualLines: [],
    }],
    fullText: lines.join("\n"), metadata: {}, extractionWarnings: [], extractionMethod: "text_layer",
  });
  assert.equal(parsed.parserName, "generic");
  assert.equal(parsed.officialTotalCents, null);
  assert.equal(parsed.bankName, null);
  assert.ok(parsed.confidence < .75);
});

test("documento sem texto não produz dados", () => {
  assert.throws(() => parseInvoiceDocument(imageOnlyFixture), /invoice_parser_not_found/);
});

const entry = (patch: Partial<ParsedInvoiceEntry>): ParsedInvoiceEntry => ({
  id: crypto.randomUUID(), transactionDate: "2026-07-03", postingDate: null,
  descriptionRaw: "Compra", descriptionNormalized: "Compra", merchantNormalized: "COMPRA",
  amountCents: 10000, currencyCode: "BRL", entryType: "purchase", cardLastFour: null,
  installment: null, confidence: .9, reviewStatus: "pending", isIgnored: false,
  sourceLineNumber: 1, ...patch,
});

test("conciliação usa centavos, aceita zero real e aponta diferença", () => {
  const matched = reconcileInvoice({ officialTotalCents: 0, entries: [] });
  assert.equal(matched.status, "matched");
  assert.equal(matched.differenceCents, 0);
  const different = reconcileInvoice({
    officialTotalCents: 10000,
    previousBalanceCents: 5000,
    entries: [entry({ amountCents: 7000 }), entry({ entryType: "credit", amountCents: -1000 })],
  });
  assert.equal(different.reconstructedTotalCents, 11000);
  assert.equal(different.differenceCents, -1000);
  assert.equal(different.status, "different");
});

test("projeção cria parcela atual e sete futuras cruzando dezembro", () => {
  const rows = projectInstallmentOccurrences({
    dueDate: "2026-07-31", currentInstallment: 3, totalInstallments: 10, amountCents: 25000,
  });
  assert.equal(rows.length, 8);
  assert.equal(rows[0].status, "posted");
  assert.equal(rows[1].installmentNumber, 4);
  assert.equal(rows.at(-1)?.competenceMonth, "2027-02-01");
  assert.equal(rows.slice(1).reduce((sum, row) => sum + row.amountCents, 0), 175000);
  assert.equal(rows[7].dueDate, "2027-02-28");
});

test("fingerprint ignora número da parcela e separa merchants", () => {
  const base = { workspaceId: "w", cardId: "c", merchant: "LOJA X PARC 03/10", amountCents: 25000, totalInstallments: 10 };
  assert.equal(buildInstallmentFingerprint(base),
    buildInstallmentFingerprint({ ...base, merchant: "LOJA X PARC 04/10" }));
  assert.notEqual(buildInstallmentFingerprint(base),
    buildInstallmentFingerprint({ ...base, merchant: "LOJA Y PARC 04/10" }));
});

test("matching automático exige alta confiança e ambiguidade fica abaixo", () => {
  const candidate = { cardId: "c", merchantNormalized: "LOJA X", installmentAmountCents: 25000,
    totalInstallments: 10, latestKnownInstallment: 3, lastCompetence: "2026-07-01" };
  const incoming = { cardId: "c", merchantNormalized: "LOJA X", installmentAmountCents: 25000,
    totalInstallments: 10, currentInstallment: 4, competenceMonth: "2026-08-01" };
  assert.ok(scoreInstallmentMatch(candidate, incoming) >= .9);
  assert.ok(scoreInstallmentMatch(candidate, { ...incoming, merchantNormalized: "OUTRA LOJA", installmentAmountCents: 24900 }) < .7);
});

test("compromissos mensais ignoram ocorrência já lançada", () => {
  const result = calculateFutureCardCommitments([
    { competenceMonth: "2026-08-01", amountCents: 25000, status: "projected", confidence: .9 },
    { competenceMonth: "2026-08-15", amountCents: 10000, status: "confirmed", confidence: .8 },
    { competenceMonth: "2026-08-01", amountCents: 5000, status: "posted", confidence: 1 },
  ]);
  assert.equal(result[0].totalCommittedCents, 35000);
  assert.equal(result[0].sourceCount, 2);
  assert.equal(result[0].confidence, .8);
});

test("migration cria bucket privado, hash único, RLS e RPC transacional", () => {
  const sql = readFileSync("supabase/migrations/202607270030_import_credit_card_invoice_pdfs.sql", "utf8");
  assert.match(sql, /financial-documents','financial-documents',false,20971520/);
  assert.match(sql, /unique\(workspace_id,card_id,file_hash\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /invoice_documents_owner/);
  assert.match(sql, /confirm_invoice_pdf_import/);
  assert.match(sql, /unique\(installment_plan_id,installment_number\)/);
  assert.match(sql, /create policy financial_documents_select/);
  const legacyBackfill = sql.indexOf("update public.card_invoices\nset source=case");
  const sourceConstraint = sql.indexOf("add constraint card_invoices_source_check");
  assert.ok(legacyBackfill >= 0 && sourceConstraint > legacyBackfill);
  assert.match(sql, /when source in \('pluggy','provider_bill'\).*then 'pluggy_bill'/);
  assert.match(sql, /when source in \('manual_bank_confirmation','manual_pdf_confirmation'\) then 'manual'/);
});

test("migration 032 versiona layout sem persistir coordenadas brutas", () => {
  const sql = readFileSync(
    "supabase/migrations/202607280032_santander_positional_invoice_parser.sql",
    "utf8",
  );
  assert.match(sql, /extraction_layout_version integer/);
  assert.match(sql, /provider_future_installment_balance numeric/);
  assert.match(sql, /next_open_invoice_amount numeric/);
  assert.match(sql, /extraction_method='text_layer'/);
  assert.match(sql, /text_layer','image_only/);
  assert.doesNotMatch(sql, /positional_text_metadata/);
});

test("rotas de PDF executam explicitamente no runtime Node.js", () => {
  for (const path of [
    "src/app/api/invoice-imports/route.ts",
    "src/app/api/invoice-imports/[id]/reprocess/route.ts",
    "src/app/api/invoice-imports/[id]/replace/route.ts",
  ]) {
    assert.match(readFileSync(path, "utf8"), /export const runtime = "nodejs"/);
  }
});
