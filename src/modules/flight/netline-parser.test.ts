import assert from "node:assert/strict";
import test from "node:test";
import { parseNetlineDate, parseNetlineDocument, reconstructSpatialLines } from "./netline-parser";

function documentWith(text: string) { return { pages: [{ pageNumber: 1, text, plainText: text, lines: text.split("\n"), items: [], visualLines: [], width: 1, height: 1 }], pageCount: 1, fullText: text, metadata: {}, extractionWarnings: [], extractionMethod: "pdfjs_legacy" as const }; }

test("interpreta datas NetLine e períodos que atravessam o ano", () => {
  assert.equal(parseNetlineDate("01Aug26"), "2026-08-01");
  assert.equal(parseNetlineDate("31Dec26"), "2026-12-31");
  const result = parseNetlineDocument(documentWith("NETLINE GOL\n01Dec26 - 02Jan27\nHome Base: BSB\nCrew ID: 12345"));
  assert.equal(result.periodStart, "2026-12-01");
  assert.equal(result.periodEnd, "2027-01-02");
  assert.equal(result.days.length, 33);
});

test("cria todos os dias de fevereiro e preserva linhas não associadas", () => {
  const result = parseNetlineDocument(documentWith("NETLINE GOL\n01Feb24 - 29Feb24\nHome Base: BSB\nCrew ID: 12345\ntexto de cabeçalho\n01Feb24 linha do primeiro dia"));
  assert.equal(result.days.length, 29);
  assert.equal(result.days[0].rawText.includes("linha do primeiro dia"), true);
  assert.equal(result.unknown.some(item => item.rawLine === "texto de cabeçalho"), true);
});

test("não reconhece um PDF genérico e não perde o diagnóstico", () => {
  const result = parseNetlineDocument(documentWith("Relatório de teste sem programação operacional"));
  assert.equal(result.documentType, null);
  assert.equal(result.warnings.some(item => item.code === "DOCUMENT_NOT_RECOGNIZED"), true);
  assert.equal(result.warnings.some(item => item.code === "MISSING_PERIOD"), true);
});

test("reconstrói o cabeçalho pela posição e preserva zeros da matrícula", () => {
  const items = [
    { pageNumber: 1, index: 0, text: "00044027", x: 30, y: 700, width: 20, height: 8, visualIndex: 0 },
    { pageNumber: 1, index: 1, text: "SANCLE", x: 70, y: 701, width: 20, height: 8, visualIndex: 1 },
    { pageNumber: 1, index: 2, text: "GOMES", x: 110, y: 700, width: 20, height: 8, visualIndex: 2 },
    { pageNumber: 1, index: 3, text: "DE", x: 150, y: 700, width: 10, height: 8, visualIndex: 3 },
    { pageNumber: 1, index: 4, text: "MESQUITA", x: 170, y: 700, width: 30, height: 8, visualIndex: 4 },
  ];
  const lines = reconstructSpatialLines(items);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "00044027 SANCLE GOMES DE MESQUITA");
  const document = { ...documentWith("NETLINE GOL\n01Aug26 - 31Aug26\nBSB"), pages: [{ ...documentWith("").pages[0], pageNumber: 1, text: "NETLINE GOL\n01Aug26 - 31Aug26\nBSB", plainText: "NETLINE GOL\n01Aug26 - 31Aug26\nBSB", lines: [], items, width: 600, height: 800 }] };
  const parsed = parseNetlineDocument(document);
  assert.equal(parsed.crewId, "00044027");
  assert.equal(parsed.crewName, "SANCLE GOMES DE MESQUITA");
  assert.equal(parsed.confidence, .95);
});
