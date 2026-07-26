import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const component = readFileSync(
  join(root, "src/components/finance/bank-account-movement-cards.tsx"),
  "utf8",
);
const overview = readFileSync(
  join(root, "src/components/finance/account-movement-analysis.tsx"),
  "utf8",
);
const dashboard = readFileSync(
  join(root, "src/modules/finance/dashboard.ts"),
  "utf8",
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

test("módulo exporta um Client Component síncrono válido", async () => {
  const importedModule = await import("./bank-account-movement-cards");
  assert.equal(typeof importedModule.BankAccountMovementCards, "function");
  assert.doesNotMatch(
    importedModule.BankAccountMovementCards.constructor.name,
    /AsyncFunction/,
  );
  assert.match(overview, /from "\.\/bank-account-movement-cards"/);
  assert.doesNotMatch(overview, /finance-metric-details/);
});

test("somente entradas e saídas abrem o diálogo acessível", () => {
  assert.match(overview, /<BankAccountMovementCards/);
  assert.match(component, /title: "Entradas da conta"/);
  assert.match(component, /title: "Saídas da conta"/);
  assert.match(component, /title: "Maior entrada"/);
  assert.match(component, /title: "Maior saída"/);
  assert.doesNotMatch(component, /title: "Receitas"/);
  assert.doesNotMatch(component, /title: "Despesas"/);
  assert.doesNotMatch(component, /A pagar|A receber/);
  assert.match(component, /type="button"/);
  assert.match(component, /aria-haspopup="dialog"/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /previous\?\.focus\(\)/);
  assert.match(component, /trapFocus/);
  assert.match(
    component,
    /if \(card\.kind === "total"\)[\s\S]*?<button[\s\S]*?Ver detalhes ›/,
  );
  assert.match(
    component,
    /<article[\s\S]*?className=\{`overview-metric \$\{card\.type\} \$\{card\.kind\}`\}/,
  );
  const largestCard = component.slice(
    component.indexOf("return (\n            <article"),
    component.indexOf("</article>", component.indexOf("return (\n            <article")),
  );
  assert.doesNotMatch(largestCard, /Ver detalhes|aria-haspopup|onClick/);
});

test("cards e detalhes usam o mesmo movimento mensal bancário", () => {
  for (const field of [
    "totalInflow",
    "totalOutflow",
    "inflowItems",
    "outflowItems",
    "previousMonthInflow",
    "previousMonthOutflow",
  ]) {
    assert.match(component, new RegExp(`movement\\.${field}`));
  }
  assert.doesNotMatch(dashboard, /metricDetails|DashboardMetric/);
});

test("detalhamento preserva ocultação, busca, filtros e paginação", () => {
  assert.match(component, /<Money value=\{total\}/);
  assert.match(component, /<Money value=\{item\.amount\}/);
  assert.match(component, /type="search"/);
  assert.match(component, /Filtrar por categoria/);
  assert.match(component, /Filtrar por origem/);
  assert.match(component, /Ordenar lançamentos/);
  assert.match(component, /setLimit\(\(current\) => current \+ 20\)/);
  assert.match(component, /Carregar mais/);
});

test("URL usa apenas details=inflow ou details=outflow e suporta Voltar", () => {
  assert.match(component, /url\.searchParams\.set\("details", type\)/);
  assert.match(component, /window\.history\.pushState/);
  assert.match(component, /window\.history\.back\(\)/);
  assert.match(component, /"inflow" \|\| value === "outflow"/);
  assert.doesNotMatch(component, /details.*payable|details.*receivable/);
});

test("drawer lateral vira bottom sheet responsivo com safe-area", () => {
  assert.match(css, /\.finance-metric-drawer\{[\s\S]*width:min\(520px,100%\)/);
  assert.match(
    css,
    /@media\(max-width:800px\)\{[\s\S]*\.finance-metric-backdrop\{align-items:flex-end/,
  );
  assert.match(css, /animation-name:metric-sheet/);
  assert.match(css, /height:min\(90dvh,760px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("item usa details sem controles interativos dentro do summary", () => {
  const summary = component.match(/<summary>[\s\S]*?<\/summary>/)?.[0];
  assert.ok(summary);
  assert.doesNotMatch(summary, /<button|<a /);
  assert.match(component, /<details className="finance-metric-item">/);
});

test("análise usa card principal amplo e grade lateral 2x2 equilibrada", () => {
  assert.match(
    css,
    /\.account-analysis-grid\{display:grid;grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,\.9fr\)/,
  );
  assert.match(
    css,
    /\.account-analysis-grid \.overview-metrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);grid-template-rows:repeat\(2,minmax\(0,1fr\)\)/,
  );
  assert.match(
    css,
    /\.account-analysis-result \.account-movement-values\{[\s\S]*border-right:1px solid var\(--finance-line\)/,
  );
  assert.match(
    css,
    /@media\(max-width:1120px\)\{[\s\S]*\.account-analysis-grid\{grid-template-columns:1fr\}/,
  );
  assert.match(
    css,
    /@media\(max-width:520px\)\{[\s\S]*\.account-analysis-grid \.overview-metrics\{grid-template-columns:1fr\}/,
  );
});
