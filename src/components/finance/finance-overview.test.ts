import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const shell = readFileSync(
  join(root, "src/components/finance/finance-shell.tsx"),
  "utf8",
);
const visibility = readFileSync(
  join(root, "src/components/finance/value-visibility.tsx"),
  "utf8",
);
const charts = readFileSync(
  join(root, "src/components/finance/overview-charts.tsx"),
  "utf8",
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const page = readFileSync(join(root, "src/app/financeiro/page.tsx"), "utf8");
const overview = readFileSync(
  join(root, "src/components/finance/finance-overview.tsx"),
  "utf8",
);
const analysis = readFileSync(
  join(root, "src/components/finance/account-movement-analysis.tsx"),
  "utf8",
);
const filters = readFileSync(
  join(root, "src/components/finance/finance-account-filters.tsx"),
  "utf8",
);
const balance = readFileSync(
  join(root, "src/components/finance/current-account-balance-card.tsx"),
  "utf8",
);
const tabs = readFileSync(
  join(root, "src/components/finance/finance-tabs.tsx"),
  "utf8",
);
const moduleSwitcher = readFileSync(
  join(root, "src/components/atlas/module-switcher.tsx"),
  "utf8",
);

test("dock móvel é global e não duplica as abas financeiras", () => {
  const dock = shell.match(
    /<nav[\s\S]*?className=\{`finance-bottom[\s\S]*?<\/nav>/,
  )?.[0];
  assert.ok(dock);
  assert.match(dock, />Início</);
  assert.match(dock, />Financeiro</);
  assert.match(dock, />Agenda</);
  assert.match(dock, />Perfil</);
  assert.doesNotMatch(dock, /Movimentações|Contas|Cartões|Visão geral/);
});

test("desktop oculta dock e mobile usa safe-area", () => {
  assert.match(css, /\.finance-bottom\{display:none\}/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media\(max-width:800px\)/);
});

test("ocultação de valores persiste e remove gráficos e tooltips", () => {
  assert.match(visibility, /window\.localStorage\.setItem/);
  assert.match(visibility, /atlas\.finance\.values-hidden/);
  assert.match(charts, /if \(hidden\) return <HiddenChart \/>/g);
  assert.doesNotMatch(visibility, /title=|data-value/);
});

test("visão geral não consulta patrimônio, investimentos ou empréstimos", () => {
  assert.doesNotMatch(page, /investments|loans|Patrimônio|patrimônio/);
  assert.match(page, /getFinanceOverviewData/);
  assert.match(page, /buildFinanceDashboard/);
});

test("sheet oferece uma única origem para todos os tipos de movimentação", () => {
  for (const label of [
    "Receita",
    "Despesa",
    "Transferência",
    "Conta a pagar",
    "Valor a receber",
    "Compra no cartão",
    "Desconto em folha",
  ]) {
    assert.match(shell, new RegExp(label));
  }
  assert.match(shell, /aria-modal="true"/);
  assert.match(shell, /event\.key === "Escape"/);
});

test("card principal usa movimentação da conta e o mesmo mês selecionado", () => {
  assert.match(analysis, /Entradas menos saídas da conta no mês selecionado/);
  assert.match(analysis, /BankAccountMovementCards/);
  assert.match(analysis, /Resultado da movimentação/);
  assert.match(filters, /name="account"/);
  assert.match(filters, /type="month"/);
  assert.match(analysis, /Como a análise da movimentação é calculada/);
  assert.match(analysis, /AccountMovementChart/);
  assert.match(analysis, /Resultado do mês/);
  assert.doesNotMatch(overview, /BalanceEvolutionChart/);
  assert.doesNotMatch(overview, /dashboard\.metrics|dashboard\.metricDetails/);
});

test("ajudas do card usam details semanticamente válido e responsivo", () => {
  assert.doesNotMatch(
    analysis,
    /<p>\s*Resultado da movimentação(?:(?!<\/p>)[\s\S])*<details/,
  );
  assert.doesNotMatch(
    analysis,
    /<span>\s*Saldo disponível(?:(?!<\/span>)[\s\S])*<details/,
  );
  assert.match(analysis, /className="overview-result-help-content"/);
  assert.match(
    analysis,
    /aria-label="Como a análise da movimentação é calculada"/,
  );
  assert.match(
    analysis,
    /title="Como a análise da movimentação é calculada"/,
  );
  assert.match(
    css,
    /\.overview-result-help-content\{position:absolute;[\s\S]*width:min\(288px,calc\(100vw - 32px\)\)/,
  );
  assert.match(css, /background:var\(--atlas-tooltip-background\)/);
});

test("gráfico da conta tem duas linhas, série cumulativa e modo diário", () => {
  assert.match(charts, /name="Entradas"/);
  assert.match(charts, /name="Saídas"/);
  assert.match(charts, /cumulativeInflow/);
  assert.match(charts, /cumulativeOutflow/);
  assert.match(charts, /dailyInflow/);
  assert.match(charts, /dailyOutflow/);
  assert.match(charts, />\s*Acumulado\s*</);
  assert.match(charts, />\s*Por dia\s*</);
});

test("workspace permanece no escopo da consulta sem aparecer como filtro", () => {
  assert.match(shell, /ModuleSwitcher/);
  assert.doesNotMatch(shell, /className="finance-workspace"|Espaço atual/);
  assert.match(filters, /type="hidden" name="workspace"/);
  assert.doesNotMatch(filters, /<span>Espaço<\/span>|aria-label="Espaço financeiro"/);
  assert.doesNotMatch(filters, /useFinanceWorkspaces/);
  assert.match(page, /workspaceId/);
});

test("seletor central mostra o módulo habilitado sem confundir Meu Atlas", () => {
  assert.match(moduleSwitcher, /current\?\.name \|\| "Financeiro"/);
  assert.match(moduleSwitcher, /role="menu"/);
  assert.match(moduleSwitcher, /event\.key === "Escape"/);
  assert.doesNotMatch(moduleSwitcher, /Meu Atlas|<svg|icon/);
});

test("menu financeiro é textual e saldo bancário não possui ícone", () => {
  assert.match(tabs, /Visão geral/);
  assert.match(tabs, /Compromissos/);
  assert.doesNotMatch(tabs, /icon|<svg|<i/);
  assert.match(balance, /Saldo atual da conta/);
  assert.doesNotMatch(balance, /<svg|<i|Icon/);
});

test("saldo e análise mensal são blocos independentes", () => {
  assert.match(overview, /CurrentAccountBalanceCard/);
  assert.match(overview, /AccountMovementAnalysis/);
  assert.match(css, /\.account-analysis-grid\{display:grid;grid-template-columns/);
  assert.match(css, /\.account-analysis-grid \.overview-metrics\{grid-template-columns:repeat\(2/);
});

test("topo da visão geral reúne saudação e título em uma única faixa", () => {
  assert.match(overview, /className="overview-hero"/);
  assert.match(
    overview,
    /className="overview-hero-greeting"[\s\S]*VISÃO GERAL[\s\S]*className="overview-hero-title"/,
  );
  assert.match(overview, /<h1 id="finance-page-title">Financeiro<\/h1>/);
  assert.match(overview, /Visão clara da sua vida financeira/);
  assert.doesNotMatch(overview, /className="overview-greeting"/);
  assert.match(
    css,
    /\.overview-hero>header\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/,
  );
  assert.match(filters, /<span>Conta<\/span>/);
  assert.match(filters, /<span>Período<\/span>/);
  assert.match(filters, />Aplicar<\/button>/);
  assert.match(shell, /const isOverview = pathname === "\/financeiro"/);
  assert.match(shell, /\{!isOverview \? \(/);
});

test("filtros ficam dentro do card de saldo sem repetir a identidade bancária", () => {
  assert.match(
    overview,
    /<CurrentAccountBalanceCard[\s\S]*filters=\{[\s\S]*<FinanceAccountFilters/,
  );
  assert.match(balance, /className="current-account-balance-filters"/);
  assert.doesNotMatch(
    balance,
    /Conta selecionada|Conta corrente|MeuPluggy|Pluggy|current-account-identity/,
  );
  assert.doesNotMatch(balance, /<svg|<i|Icon/);
  assert.match(
    css,
    /\.current-account-balance-filters \.overview-period\{display:grid;grid-template-columns:/,
  );
  assert.match(css, /@media\(max-width:520px\)\{[\s\S]*\.overview-hero>header\{grid-template-columns:1fr/);
});
