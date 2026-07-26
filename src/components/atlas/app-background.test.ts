import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const orbital = readFileSync(
  join(root, "src/components/atlas/orbital-background.tsx"),
  "utf8",
);
const appBackground = readFileSync(
  join(root, "src/components/atlas/app-background.tsx"),
  "utf8",
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const themeToggle = readFileSync(
  join(root, "src/components/atlas/theme-toggle.tsx"),
  "utf8",
);
const layout = readFileSync(join(root, "src/app/layout.tsx"), "utf8");
const financeLayout = readFileSync(
  join(root, "src/app/financeiro/layout.tsx"),
  "utf8",
);
const charts = [
  readFileSync(
    join(root, "src/components/finance/overview-charts.tsx"),
    "utf8",
  ),
  readFileSync(join(root, "src/components/finance/finance-chart.tsx"), "utf8"),
].join("\n");

test("fundo central reutiliza as paisagens espaciais originais nos dois temas", () => {
  assert.match(orbital, /\/assets\/atlas\/login-desktop-dark\.png/);
  assert.match(orbital, /\/assets\/atlas\/login-mobile-dark\.png/);
  assert.match(orbital, /\/assets\/atlas\/login-desktop-light\.png/);
  assert.match(orbital, /\/assets\/atlas\/login-mobile-light\.png/);
  assert.match(appBackground, /OrbitalBackground/);
});

test("tema claro preserva a paisagem azul sem filtro escuro do Financeiro", () => {
  assert.match(css, /--atlas-page-background: #dcecff/);
  assert.match(css, /--atlas-background-opacity: \.98/);
  assert.match(css, /--atlas-background-filter: saturate\(1\.08\)/);
  assert.match(css, /radial-gradient\(ellipse at center/);
  assert.doesNotMatch(css, /\.finance-app \.atlas-app-background\{/);
  assert.doesNotMatch(css, /\.finance-app::after/);
});

test("tema escuro mantém a identidade aprovada sem alterar o tema claro", () => {
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /--atlas-page-background: #081321/);
  assert.match(css, /--atlas-background-opacity: \.78/);
  assert.match(
    css,
    /--atlas-background-filter: saturate\(\.74\) brightness\(\.72\)/,
  );
});

test("cards e gráficos usam tokens globais sensíveis ao tema", () => {
  assert.match(css, /--atlas-card: rgba\(255, 255, 255, \.97\)/);
  assert.match(css, /--atlas-chart-axis: #586a80/);
  assert.match(
    css,
    /--atlas-tooltip-background: rgba\(255, 255, 255, \.98\)/,
  );
  assert.match(
    css,
    /\.finance-stat,\.finance-panel\{[\s\S]*background:var\(--atlas-card\)/,
  );
  assert.match(charts, /var\(--atlas-chart-grid\)/);
  assert.match(charts, /var\(--atlas-tooltip-background\)/);
});

test("paisagem usa cover, não repete e possui enquadramento móvel", () => {
  assert.match(css, /\.atlas-landscape img[\s\S]*object-fit: cover/);
  assert.match(orbital, /media="\(max-width: 640px\)"/);
  assert.match(
    css,
    /\.finance-app \.atlas-landscape img\{object-position:center 58%\}/,
  );
  assert.match(
    css,
    /\.finance-app>\.atlas-app-background\{position:absolute\}/,
  );
  assert.match(css, /overflow:hidden|overflow:clip/);
});

test("alternância persiste e é aplicada antes da primeira pintura", () => {
  assert.match(themeToggle, /localStorage\.setItem\(THEME_STORAGE_KEY/);
  assert.match(themeToggle, /document\.documentElement\.dataset\.theme/);
  assert.match(themeToggle, /classList\.toggle\("dark"/);
  assert.match(layout, /strategy="beforeInteractive"/);
  assert.match(layout, /localStorage\.getItem\('atlas-theme'\)/);
});

test("todas as páginas financeiras recebem o mesmo shell temático", () => {
  assert.match(financeLayout, /FinanceShell/);
  assert.match(financeLayout, /\{children\}/);
});
