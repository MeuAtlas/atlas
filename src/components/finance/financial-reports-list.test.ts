import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/financeiro/relatorios/page.tsx", "utf8");
const view = readFileSync("src/components/finance/financial-reports-list.tsx", "utf8");
const styles = readFileSync("src/app/globals.css", "utf8");

test("listagem atual usa quatro colunas e separa histórico", () => {
  assert.match(view, /Mês[\s\S]*Como está[\s\S]*Cartão do mês[\s\S]*Ação/);
  assert.match(page, /ActiveFinancialMonths/);
  assert.match(page, /ClosedFinancialReports/);
  assert.doesNotMatch(page, /Consumo pessoal[\s\S]*Fatura prevista/);
});

test("mobile usa cards verticais sem tabela horizontal", () => {
  assert.match(styles, /@media\(max-width:720px\)[\s\S]*\.active-financial-month-row\{display:grid;grid-template-columns:1fr/);
  assert.match(styles, /\.active-financial-months-head\{display:none\}/);
  assert.doesNotMatch(styles, /active-financial-months[^}]*overflow-x/);
});

test("mês planejado não mostra resultado fictício", () => {
  assert.match(view, /Ainda não iniciado/);
  assert.match(view, /Sem movimentações fictícias/);
});
