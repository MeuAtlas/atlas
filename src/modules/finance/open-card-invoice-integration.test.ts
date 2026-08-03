import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  openInvoiceDifference,
  resolveOpenInvoiceTotal,
} from "./open-card-invoice";

test("caso 7082,45 preserva o snapshot confiável com detalhe parcial", () => {
  const total = resolveOpenInvoiceTotal({
    calculatedTotal: 7082.45,
    calculatedReliable: false,
    lastReliableTotal: 7669.72,
    persistedDisplayTotal: 7669.72,
    persistedDataCompleteness: "partial",
  });
  assert.deepEqual(
    {
      cards: total.amount,
      movements: total.amount,
      overview: total.amount,
      difference: openInvoiceDifference(total.amount, 7082.45),
      detailsCompleteness: "partial",
    },
    {
      cards: 7669.72,
      movements: 7669.72,
      overview: 7669.72,
      difference: 587.27,
      detailsCompleteness: "partial",
    },
  );
});

test("as três páginas chamam o mesmo resolvedor", () => {
  const cards = readFileSync(
    "src/app/financeiro/cartoes/page.tsx",
    "utf8",
  );
  const movements = readFileSync(
    "src/app/financeiro/movimentacoes/page.tsx",
    "utf8",
  );
  const overview = [
    readFileSync("src/app/financeiro/page.tsx", "utf8"),
    readFileSync("src/modules/finance/finance-overview-query.ts", "utf8"),
  ].join("\n");
  for (const source of [cards, movements, overview]) {
    assert.match(source, /resolveOpenCardInvoice/);
  }
  assert.doesNotMatch(movements, /confirmedOpenTotal:\s*selectedCycle\?\.officialTotal/);
});

test("resolvedor padrão escolhe somente ciclo aberto atual e mais recente", () => {
  const queries = readFileSync("src/modules/finance/queries.ts", "utf8");
  assert.match(
    queries,
    /\.eq\("status", "open"\)[\s\S]*\.lte\("cycle_start_date", referenceDate\)[\s\S]*\.gte\("cycle_end_date", referenceDate\)/,
  );
  assert.match(
    queries,
    /\.order\("cycle_end_date", \{ ascending: false \}\)[\s\S]*\.order\("updated_at", \{ ascending: false \}\)/,
  );
});

test("componentes não apagam o total quando o detalhe está parcial", () => {
  const compact = readFileSync(
    "src/components/finance/current-invoice-compact-card.tsx",
    "utf8",
  );
  const movements = readFileSync(
    "src/components/finance/movements-browser.tsx",
    "utf8",
  );
  assert.match(compact, /resolvedInvoice\.displayTotal/);
  assert.match(compact, /Estimativa baseada nas compras sincronizadas/);
  assert.match(movements, /resolvedOpenInvoice/);
  assert.match(movements, /Detalhamento parcial/);
});
