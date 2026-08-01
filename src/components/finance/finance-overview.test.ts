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
const expenseDetails = readFileSync(
  join(root, "src/components/finance/next-month-expense-details.tsx"),
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

test("visão geral usa uma agregação central sem consultar patrimônio na rota", () => {
  assert.doesNotMatch(page, /investments|loans|Patrimônio|patrimônio/);
  assert.match(page, /getFinanceOverviewDashboard/);
});

test("shell não oferece criação manual de movimentação", () => {
  assert.doesNotMatch(shell, /Nova movimentação/);
  assert.doesNotMatch(shell, /AddMovementSheet/);
  assert.doesNotMatch(shell, /finance-bottom-add/);
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
  assert.match(tabs, /Receitas e Despesas/);
  assert.doesNotMatch(tabs, /icon|<svg|<i/);
  assert.match(balance, /Saldo atual da conta/);
  assert.doesNotMatch(balance, /<svg|<i|Icon/);
});

test("posição e fluxo mensal são blocos executivos independentes", () => {
  assert.match(overview, /className="fov-position-grid"/);
  assert.match(overview, /className="fov-flow-layout"/);
  assert.match(overview, /AccountMovementChart/);
  assert.match(css, /\.fov-position-grid\{display:grid;grid-template-columns:repeat\(4/);
});

test("topo reúne saudação, competência e filtros compactos", () => {
  assert.match(overview, /className="fov-header"/);
  assert.match(overview, /VISÃO GERAL/);
  assert.match(overview, /Sua posição financeira em/);
  assert.doesNotMatch(overview, /<h1[^>]*>Financeiro<\/h1>/);
  assert.match(filters, /<span>Conta<\/span>/);
  assert.match(filters, /<span>Período<\/span>/);
  assert.match(filters, />Aplicar<\/button>/);
  assert.match(css, /\.fov-header\{display:flex;align-items:end;justify-content:space-between/);
  assert.doesNotMatch(shell, /Nova movimentação/);
});

test("filtros ficam integrados ao cabeçalho e empilham no mobile", () => {
  assert.match(overview, /className="fov-header"[\s\S]*<FinanceAccountFilters/);
  assert.match(css, /\.fov-header \.overview-period\{display:grid;grid-template-columns:/);
  assert.match(css, /@media\(max-width:520px\)[\s\S]*\.fov-header \.overview-period\{grid-template-columns:1fr/);
});

test("despesas previstas explicam compromissos, faturas e exclusões em modal", () => {
  assert.match(overview, /NextMonthExpenseDetails/);
  assert.match(expenseDetails, /aria-haspopup="dialog"/);
  assert.match(expenseDetails, />\s*Detalhes\s*</);
  assert.match(expenseDetails, /Compromissos fora do cartão/);
  assert.match(expenseDetails, /Faturas com vencimento no mês/);
  assert.match(expenseDetails, /Já incluídos nas faturas/);
  assert.match(expenseDetails, /Descontos em folha/);
  assert.match(expenseDetails, /não são somados novamente/);
  assert.match(expenseDetails, /Veja os valores considerados na previsão e os itens apenas informativos/);
  assert.match(expenseDetails, /variant="modalTitle"/);
  assert.match(expenseDetails, /variant="financialValueSmall"/);
  assert.match(expenseDetails, /Já descontados antes do salário líquido entrar na conta/);
  assert.doesNotMatch(expenseDetails, /Não somado às despesas previstas/);
  assert.doesNotMatch(expenseDetails, /Já considerado na fatura/);
  assert.match(css, /\.fov-expense-equation\{/);
  assert.match(css, /\.fov-expense-detail-row b \{ font-size: 16px/);
  assert.match(css, /\.fov-expense-detail-row small \{ font-size: 15px !important/);
  assert.match(css, /\.atlas-modal-close \{ width: 44px; height: 44px/);
});
