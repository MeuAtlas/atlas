import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  openInvoiceDifference,
  resolveOpenInvoiceTotal,
} from "./open-card-invoice";

test("caso 7082,45 permanece confirmado com detalhe parcial", () => {
  const total = resolveOpenInvoiceTotal({
    confirmedOpenTotal: 7082.45,
    calculatedTotal: 6942.14,
    calculatedReliable: false,
    lastReliableTotal: 6900,
  });
  assert.deepEqual(
    {
      cards: total.amount,
      movements: total.amount,
      overview: total.amount,
      difference: openInvoiceDifference(total.amount, 6942.14),
      detailsCompleteness: "partial",
    },
    {
      cards: 7082.45,
      movements: 7082.45,
      overview: 7082.45,
      difference: 140.31,
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
  const overview = readFileSync("src/app/financeiro/page.tsx", "utf8");
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
  assert.match(compact, /O total confirmado permanece disponível/);
  assert.match(movements, /resolvedOpenInvoice/);
  assert.match(movements, /Detalhamento parcial/);
});
