import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync("src/components/finance/monthly-report-view.tsx", "utf8");
const reviewView = readFileSync("src/components/finance/monthly-report-review-view.tsx", "utf8");
const page = readFileSync("src/app/financeiro/relatorios/[ano]/[mes]/page.tsx", "utf8");
const list = readFileSync("src/app/financeiro/relatorios/page.tsx", "utf8");
const listService = readFileSync("src/modules/finance/financial-reports-list.ts", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const pdfRoute = readFileSync("src/app/api/monthly-reports/[id]/pdf/route.ts", "utf8");

test("página mensal reúne pendências, leitura, fluxo, consumo, futuro e revisão final", () => {
  for (const component of ["MonthlyBlockingIssues", "MonthlySummaryGrid", "MonthlyAtlasReading", "MonthlyCashFlowReviewSection", "MonthlyIncomeSection", "MonthlyConsumptionSection", "MonthlyCommitmentsSection", "MonthlyPaidCardSection", "MonthlyNextStatementSection", "MonthlyFutureSection", "MonthlyFinalReview", "MonthlyCloseSection"]) {
    assert.match(page, new RegExp(`<${component}`));
  }
  assert.match(reviewView, /Antes de concluir/);
  assert.match(reviewView, /Para onde foi o dinheiro/);
  assert.match(reviewView, /Revisão final/);
});

test("relatório fechado remove edição e oferece visualizar e baixar o PDF", () => {
  assert.match(page, /data\.financialMonth\.status === "closed"/);
  assert.match(reviewView, /Ver relatório/);
  assert.match(reviewView, /view\.header\.status !== "closed"/);
  assert.match(pdfRoute, /searchParams\.get\("download"\) === "1"/);
  assert.match(pdfRoute, /createSignedUrl\([\s\S]*\{ download \}/);
});

test("lista usa ações por estado e preserva filtros relevantes", () => {
  assert.match(listService, /open: "Acompanhar"/);
  assert.match(listService, /review: "Revisar e concluir"/);
  assert.match(listService, /closed: "Ver relatório"/);
  for (const filter of ["financialProfile", "profile", "account", "person", "view"]) assert.match(list, new RegExp(`"${filter}"`));
});

test("PDF mensal usa páginas por necessidade e mantém o anexo bancário separado", () => {
  const pdf = readFileSync("src/modules/finance/monthly-financial-report-pdf.ts", "utf8");
  assert.match(pdf, /requiredHeight/);
  assert.match(pdf, /if \(y - requiredHeight < 52\)/);
  assert.match(pdf, /appendixPage\(true\)/);
  assert.match(pdf, /pages\.length/);
  assert.doesNotMatch(pdf, /\/5`/);
  assert.match(pdf, /Anexo - movimento da conta corrente/);
  assert.match(pdf, /entry\.sourceKind !== "card"/);
});

test("resumo é um painel único e a ação final não flutua sobre o conteúdo", () => {
  assert.match(view, /monthly-summary-panel/);
  assert.match(css, /monthly-summary-panel\{[^}]*overflow:hidden/);
  assert.match(css, /monthly-report-page \.monthly-close-box\{position:static\}/);
});
