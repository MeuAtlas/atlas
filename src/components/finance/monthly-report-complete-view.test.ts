import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync("src/components/finance/monthly-report-view.tsx", "utf8");
const page = readFileSync("src/app/financeiro/relatorios/[ano]/[mes]/page.tsx", "utf8");
const list = readFileSync("src/app/financeiro/relatorios/page.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
const pdfRoute = readFileSync("src/app/api/monthly-reports/[id]/pdf/route.ts", "utf8");

test("página mensal reúne leitura, perspectivas, fluxo, consumo, futuro e conferência", () => {
  for (const component of ["MonthlyNarrative", "MonthlyPerspectiveSections", "MonthlyCashFlowSection", "PersonalConsumptionSection", "MonthlyFutureAndLoans", "MonthlyTransactionsSection"]) {
    assert.match(page, new RegExp(`<${component}`));
  }
  assert.match(view, /Renda em perspectiva/);
  assert.match(view, /Cartão em perspectiva/);
  assert.match(view, /Compromissos futuros/);
  assert.match(view, /Movimentações do período/);
});

test("relatório fechado remove edição e oferece visualizar e baixar o PDF", () => {
  assert.match(page, /status !== "closed"/);
  assert.match(page, /Visualizar PDF/);
  assert.match(page, /Baixar PDF/);
  assert.match(pdfRoute, /searchParams\.get\("download"\) === "1"/);
  assert.match(pdfRoute, /createSignedUrl\([\s\S]*\{ download \}/);
});

test("lista usa ações por estado e preserva filtros relevantes", () => {
  assert.match(list, /open: "Acompanhar"/);
  assert.match(list, /review: "Revisar e concluir"/);
  assert.match(list, /closed: "Ver relatório"/);
  for (const filter of ["profile", "account", "person", "view"]) assert.match(list, new RegExp(`"${filter}"`));
});

test("resumo é um painel único e a ação final não flutua sobre o conteúdo", () => {
  assert.match(view, /monthly-summary-panel/);
  assert.match(css, /monthly-summary-panel\{[^}]*overflow:hidden/);
  assert.match(css, /monthly-report-page \.monthly-close-box\{position:static\}/);
});
