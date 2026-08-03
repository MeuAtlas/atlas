import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const pageSource = readFileSync("src/app/financeiro/relatorios/[ano]/[mes]/page.tsx", "utf8");
const reviewSource = readFileSync("src/components/finance/monthly-report-review-view.tsx", "utf8");
const routeSource = readFileSync("src/app/api/monthly-reports/preview/[ano]/[mes]/route.ts", "utf8");
const pdfSource = readFileSync("src/modules/finance/monthly-financial-report-pdf.ts", "utf8");

test("oferece visualização e download durante a revisão sem depender de um estado transitório", () => {
  assert.doesNotMatch(pageSource, /status === "awaiting_consolidation"/);
  assert.match(pageSource, /previewPdfUrl/);
  assert.match(reviewSource, /Ver prévia do PDF/);
  assert.match(reviewSource, /Baixar prévia/);
  assert.match(routeSource, /status === "closed"/);
  assert.doesNotMatch(routeSource, /status !== "awaiting_consolidation"/);
  assert.match(routeSource, /"attachment" : "inline"/);
});

test("gera uma prévia dinâmica sem confundi-la com a versão oficial", () => {
  assert.match(routeSource, /preview: true/);
  assert.match(routeSource, /private, no-store/);
  assert.match(pdfSource, /Prévia dinâmica/);
  assert.match(pdfSource, /não é o fechamento oficial/);
  assert.match(pdfSource, /input\.preview\s*\? input\.snapshot\.issues/);
});
