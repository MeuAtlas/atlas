import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const drawer = readFileSync(
  join(root, "src/components/finance/invoice-details-drawer.tsx"),
  "utf8",
);
const card = readFileSync(
  join(root, "src/components/finance/current-invoice-card.tsx"),
  "utf8",
);
const calculation = readFileSync(
  join(root, "src/modules/finance/card-invoices.ts"),
  "utf8",
);
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");

test("card mantém uma única ação que abre o drawer sem navegar", () => {
  assert.match(card, /<InvoiceDetailsDrawer invoice=\{invoice\} \/>/);
  assert.doesNotMatch(card, />Abrir detalhes<\/Link>|>Abrir detalhes<\/a>/);
  assert.match(drawer, />\s*Ver detalhes\s*<\/button>/);
  assert.match(drawer, /aria-haspopup="dialog"/);
  assert.match(drawer, /aria-label=\{`Ver detalhes da fatura/);
});

test("drawer é modal, fecha com Escape, prende e devolve o foco", () => {
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /aria-labelledby=/);
  assert.match(drawer, /event\.key === "Escape"/);
  assert.match(drawer, /trapFocus/);
  assert.match(drawer, /previous\?\.focus\(\)/);
  assert.match(drawer, /aria-label="Fechar detalhes da fatura"/);
  assert.match(drawer, /window\.history\.pushState/);
  assert.match(drawer, /window\.history\.back\(\)/);
});

test("lista oferece busca, filtros, instrumentos, ordenação e paginação", () => {
  assert.match(drawer, /type="search"/);
  for (const label of [
    "Todos",
    "Compras",
    "Parcelas",
    "Estornos",
    "Créditos",
    "Tarifas",
    "Pendentes",
    "Sem cartão",
  ]) {
    assert.match(drawer, new RegExp(`"${label}"`));
  }
  assert.match(drawer, /Instrumento/);
  assert.match(drawer, /Mais recentes/);
  assert.match(drawer, /Mais antigas/);
  assert.match(drawer, /Maior valor/);
  assert.match(drawer, /Menor valor/);
  assert.match(drawer, /filtered\.slice\(0, limit\)/);
  assert.match(drawer, /setLimit\(\(current\) => current \+ 20\)/);
  assert.match(drawer, /Carregar mais/);
});

test("auditoria usa o mesmo serviço central do card", () => {
  assert.match(card, /getEstimatedInvoiceDetails\(invoice\)/);
  assert.match(drawer, /getEstimatedInvoiceDetails\(invoice\)/);
  assert.match(calculation, /export function getEstimatedInvoiceDetails/);
  assert.match(drawer, /details\.includedPurchases/);
  assert.match(drawer, /details\.calculatedTotal/);
  assert.match(drawer, /details\.displayedTotal/);
  assert.match(drawer, /Não foi possível comparar com uma fatura oficial/);
});

test("itens expansíveis não aninham controles no summary", () => {
  const itemSummary = drawer.match(
    /<summary>[\s\S]*?<\/summary>\s*<div className="invoice-details-item-body"/,
  )?.[0];
  assert.ok(itemSummary);
  assert.doesNotMatch(itemSummary, /<button|<a /);
  assert.match(drawer, /Parcelamento não informado pelo banco/);
  assert.match(drawer, /maskedExternalId/);
  assert.match(drawer, /Incluído no total calculado/);
});

test("pagamentos e exclusões aparecem separados do consumo", () => {
  assert.match(drawer, /Pagamento vinculado/);
  assert.match(drawer, /não forma o\s+total de consumo/);
  assert.match(drawer, /Lançamentos não considerados/);
  assert.match(calculation, /purchase\.transaction_role !== "invoice_payment"/);
  assert.match(calculation, /reason: "duplicate"/);
});

test("desktop usa drawer lateral e mobile usa bottom sheet seguro", () => {
  assert.match(
    css,
    /\.invoice-details-drawer\{[\s\S]*width:min\(590px,100%\);height:100%/,
  );
  assert.match(
    css,
    /@media\(max-width:800px\)\{\.invoice-details-backdrop\{align-items:flex-end\}/,
  );
  assert.match(css, /height:min\(92dvh,820px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.invoice-details-body\{[\s\S]*overflow-x:hidden/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test("drawer possui skeleton, erro e vazio sem derrubar a visão geral", () => {
  assert.match(drawer, /invoice-details-skeleton/);
  assert.match(drawer, /Não foi possível carregar os detalhes desta fatura/);
  assert.match(drawer, /Tentar novamente/);
  assert.match(drawer, /Nenhuma compra foi encontrada neste ciclo/);
  assert.match(drawer, /\[Atlas Invoice Details Error\]/);
  assert.doesNotMatch(drawer, /error\.message|error\.stack|raw_metadata/);
});
