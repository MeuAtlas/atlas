import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/finance/invoice-history-section.tsx",
  "utf8",
);
const page = readFileSync("src/app/financeiro/cartoes/page.tsx", "utf8");
const detailPage = readFileSync(
  "src/app/financeiro/cartoes/[id]/page.tsx",
  "utf8",
);
const valueVisibility = readFileSync(
  "src/components/finance/value-visibility.tsx",
  "utf8",
);
const accountAnalysis = readFileSync(
  "src/components/finance/account-movement-analysis.tsx",
  "utf8",
);
const normalizer = readFileSync(
  "src/modules/finance/invoice-history.ts",
  "utf8",
);

test("histórico usa URL compartilhável, filtros e paginação", () => {
  assert.match(page, /view === "history"/);
  assert.match(page, /getCreditCardInvoiceHistory/);
  assert.match(source, /name="card"/);
  assert.match(source, /name="year"/);
  assert.match(source, /name="status"/);
  assert.match(source, /Próximas faturas/);
});

test("submenu e detalhe de cartões não renderizam o controle de ocultar valores", () => {
  assert.match(page, /<ValueVisibility controls=\{false\}>/);
  assert.match(detailPage, /<ValueVisibility controls=\{false\}>/);
  assert.match(page, /CreditCardViewTabs activeView=\{view\}/);
  assert.match(page, /view === "history"/);
  assert.match(page, /view === "manage"/);
  assert.match(page, /view === "archived"/);
  assert.doesNotMatch(page, /ValueVisibilityButton|finance-eye/);
  assert.doesNotMatch(detailPage, /ValueVisibilityButton|finance-eye/);
});

test("controle compartilhado continua disponível fora de Cartões", () => {
  assert.match(
    valueVisibility,
    /controls \? <ValueVisibilityButton className="finance-eye" \/> : null/,
  );
  assert.match(accountAnalysis, /<ValueVisibilityButton className="overview-hide-values" \/>/);
});

test("detalhes são acessíveis, responsivos e fecham com Escape", () => {
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /Pagamento da fatura/);
  assert.match(source, /lançamentos identificados pelo Atlas/);
});

test("drawer e histórico separam total confirmado, valor calculado e conciliação", () => {
  assert.match(source, /Total confirmado da fatura/);
  assert.match(source, /Total confirmado/);
  assert.match(source, /Lançamentos identificados/);
  assert.match(source, /Diferença ainda não detalhada/);
  assert.match(source, /Conciliação/);
  assert.match(source, /confirmado pelo pagamento integral/);
  assert.match(source, /Conta pagadora/);
  assert.match(source, /<Money value=\{invoice\.total\}/);
  assert.match(source, /<Money value=\{invoice\.calculatedTotal\}/);
  assert.match(source, /<Money value=\{invoice\.paidAmount\}/);
  assert.match(normalizer, /purchase\.transaction_role !== "invoice_payment"/);
  assert.match(normalizer, /confirmed_by_full_payment/);
});
