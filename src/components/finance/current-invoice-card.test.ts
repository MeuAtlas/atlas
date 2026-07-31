import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const compact = readFileSync(
  join(root, "src/components/finance/current-invoice-compact-card.tsx"),
  "utf8",
);
const drawer = readFileSync(
  join(root, "src/components/finance/invoice-details-drawer.tsx"),
  "utf8",
);
const detail = readFileSync(
  join(root, "src/app/financeiro/cartoes/[id]/page.tsx"),
  "utf8",
);
const overview = readFileSync(
  join(root, "src/components/finance/finance-overview.tsx"),
  "utf8",
);

test("resumo usa grade no desktop e carrossel com snap no mobile", () => {
  assert.match(
    css,
    /\.current-invoice-grid,[^{]*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  );
  assert.match(
    css,
    /@media\(max-width:800px\)\{\.current-invoice-grid,[^{]*\{grid-template-columns:1fr\}/,
  );
  assert.match(
    css,
    /\.dashboard-invoice-grid\{display:grid;grid-template-columns:repeat\(auto-fit/,
  );
  assert.match(
    css,
    /\.dashboard-invoice-grid\{display:flex;[^}]*scroll-snap-type:x mandatory/,
  );
  assert.match(
    css,
    /\.current-invoice-summary-card\{[^}]*height:auto;[^}]*min-height:300px/,
  );
});

test("resumo compacto prioriza o resolvedor central e mantém o selector como fallback", () => {
  assert.match(compact, /getCurrentInvoiceSummary\(invoice\)/);
  assert.match(compact, /resolvedInvoice\s*\?\s*resolvedInvoice\.displayTotal\s*:\s*summary\.displayAmount/);
  assert.match(compact, /displayAmount === null/);
  assert.match(compact, /<Money value=\{displayAmount\}/);
  assert.match(compact, /summary\.purchaseCount === null/);
  assert.doesNotMatch(
    compact,
    /Pluggy|Fonte atualizada|Movimentações conciliadas|Diferença/,
  );
  assert.doesNotMatch(
    compact,
    /invoice-purchase-preview|card-instrument-list|limit-progress/,
  );
});

test("resumo e detalhe partem da mesma normalização de fatura", () => {
  assert.match(compact, /getCurrentInvoiceSummary/);
  assert.match(detail, /getCurrentBillSummary/);
  assert.match(detail, /resolveOpenCardInvoice/);
  assert.match(detail, /resolvedInvoice\.displayTotal/);
  assert.match(detail, /billSummary\.purchasesCount/);
  assert.match(detail, /billSummary\.periodStart/);
  assert.match(detail, /billSummary\.closesAt/);
  assert.match(detail, /billSummary\.dueAt/);
});

test("visão geral abre detalhes no próprio contexto", () => {
  assert.match(compact, /InvoiceDetailsDrawer/);
  assert.match(drawer, /createPortal/);
  assert.match(drawer, /Ver detalhes/);
  assert.doesNotMatch(compact, /Abrir detalhes/);
});

test("seção aponta para faturas atuais e tem vazio compacto", () => {
  assert.match(overview, /\/financeiro\/cartoes\?view=current/);
  assert.match(overview, /Nenhuma fatura aberta/);
  assert.match(overview, /Os cartões ativos aparecerão aqui/);
  assert.doesNotMatch(
    overview,
    /Faturas vigentes[\s\S]*?overview-section-warning[\s\S]*?Próximos compromissos/,
  );
});
