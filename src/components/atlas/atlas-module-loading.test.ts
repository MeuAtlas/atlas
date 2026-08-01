import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AtlasModuleLoading } from "./atlas-module-loading";

const root = process.cwd();
const component = readFileSync(
  join(root, "src/components/atlas/atlas-module-loading.tsx"),
  "utf8",
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const loadingFiles = {
  overview: "src/app/financeiro/loading.tsx",
  transactions: "src/app/financeiro/movimentacoes/loading.tsx",
  accounts: "src/app/financeiro/contas/loading.tsx",
  cards: "src/app/financeiro/cartoes/loading.tsx",
  loans: "src/app/financeiro/emprestimos/loading.tsx",
  planning: "src/app/financeiro/planejamento/loading.tsx",
  reports: "src/app/financeiro/relatorios/loading.tsx",
  integrations: "src/app/financeiro/integracoes/loading.tsx",
} as const;

test("renderiza título, descrição e região de status acessível", () => {
  const html = renderToStaticMarkup(
    createElement(AtlasModuleLoading, {
      title: "Carregando movimentações",
      description: "Sincronizando entradas e saídas.",
      skeletonType: "transactions",
    }),
  );
  assert.match(html, /Carregando movimentações/);
  assert.match(html, /Sincronizando entradas e saídas/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-skeleton="transactions"/);
});

test("planeta é SVG decorativo e não adiciona imagem raster", () => {
  const html = renderToStaticMarkup(
    createElement(AtlasModuleLoading, {
      title: "Carregando",
      showSkeleton: false,
    }),
  );
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  assert.match(html, /atlas-loading-orbit/);
  assert.match(html, /atlas-loading-satellite/);
  assert.doesNotMatch(component, /<img|background-image|url\([^#]/);
});

test("cada variante produz um skeleton estrutural próprio", () => {
  for (const type of Object.keys(loadingFiles)) {
    const html = renderToStaticMarkup(
      createElement(AtlasModuleLoading, {
        title: "Carregando",
        skeletonType: type as keyof typeof loadingFiles,
      }),
    );
    assert.match(html, new RegExp(`data-skeleton="${type}"`));
  }
});

test("loadings reutilizam o componente central, salvo dashboard executivo estrutural", () => {
  const expected = {
    overview: "Preparando sua visão financeira",
    transactions: "Carregando movimentações",
    accounts: "Carregando suas contas",
    cards: "Carregando cartões",
    loans: "Carregando empréstimos",
    planning: "Calculando projeções",
    reports: "Preparando relatórios",
    integrations: "Verificando integrações",
  } as const;
  for (const [type, path] of Object.entries(loadingFiles)) {
    const source = readFileSync(join(root, path), "utf8");
    if (type === "overview") {
      assert.match(source, /fov-loading/);
      assert.match(source, /length: 4/);
      assert.doesNotMatch(source, /AtlasModuleLoading/);
      continue;
    }
    if (type === "integrations") {
      assert.match(source, /IntegrationsSkeleton/);
      assert.doesNotMatch(source, /AtlasModuleLoading/);
      continue;
    }
    assert.match(source, /AtlasModuleLoading/);
    assert.match(source, new RegExp(`skeletonType="${type}"`));
    assert.match(source, new RegExp(expected[type as keyof typeof expected]));
    assert.doesNotMatch(source, /finance-skeleton|background-image/);
  }
});

test("tema claro e escuro possuem tokens próprios para planeta e skeleton", () => {
  assert.match(css, /:root \{[\s\S]*--atlas-loading-surface:/);
  assert.match(
    css,
    /:root\[data-theme="dark"\] \{[\s\S]*--atlas-loading-surface:/,
  );
  assert.match(css, /--atlas-loading-planet-highlight:/);
  assert.match(css, /background:var\(--atlas-loading-surface\)/);
});

test("reduced motion remove órbita, pulso, pontos e skeleton animado", () => {
  assert.match(
    css,
    /@media\(prefers-reduced-motion:reduce\)\{[\s\S]*\.atlas-loading-orbit-spinner[\s\S]*animation:none!important/,
  );
  assert.match(css, /\.atlas-loading-planet-core/);
  assert.match(css, /atlas-loading-soft-pulse/);
});

test("desktop, tablet e mobile mantêm skeleton estável sem scroll lateral", () => {
  assert.match(
    css,
    /\.atlas-loading-overview\{display:grid;grid-template-columns:minmax\(0,1\.55fr\)/,
  );
  assert.match(
    css,
    /@media\(max-width:1000px\)\{[\s\S]*\.atlas-loading-overview\{grid-template-columns:1fr\}/,
  );
  assert.match(
    css,
    /@media\(max-width:520px\)\{[\s\S]*\.atlas-loading-card-grid\{grid-template-columns:1fr\}/,
  );
  assert.doesNotMatch(css, /\.finance-skeleton\{/);
  assert.doesNotMatch(css, /atlas-loading[\s\S]{0,120}background-size:200%/);
});

test("modo compacto preserva a mesma linguagem visual", () => {
  const html = renderToStaticMarkup(
    createElement(AtlasModuleLoading, {
      title: "Atualizando seção",
      compact: true,
      showSkeleton: false,
    }),
  );
  assert.match(html, /atlas-module-loading default compact/);
  assert.match(css, /\.atlas-module-loading\.compact/);
});
