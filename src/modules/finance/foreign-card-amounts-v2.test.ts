import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeCardMovementAmounts,
  persistedCardMovementAmountBrl,
} from "./foreign-card-movement";
import { calculateInvoiceAmounts } from "./card-invoices";
import {
  calculateMovementSummaryByFilter,
  normalizeCardPurchase,
} from "./movement-filters";
import type { CardPurchase } from "./types";

const github = {
  id: "github",
  card_id: "card",
  invoice_id: "cycle",
  description: "Github, Inc.",
  total_amount: 12.2,
  installment_amount: 12.2,
  amount_brl: 65.62,
  purchase_date: "2026-07-15",
  competence_date: "2026-07-15",
  installment_number: 1,
  installment_count: 1,
  source: "pluggy",
  source_type: "card",
  financial_origin: "credit_card",
  transaction_role: "consumption",
  status: "realized",
  review_status: "reviewed",
  invoice_reference: null,
  bill_forecast_date: null,
  provider_category: null,
  merchant: "Github, Inc.",
  visibility: "private",
  category_id: null,
  currency: "USD",
  original_amount: 12.2,
  original_currency_code: "USD",
  foreign_iof_amount: 2.3,
  conversion_source: "manual",
} satisfies CardPurchase;

test("regressÃ£o Github usa 65,62 na lista e preserva US$ 12,20", () => {
  const item = normalizeCardPurchase(github);
  assert.equal(item.amountBrl, 65.62);
  assert.equal(item.amount, 65.62);
  assert.equal(item.originalAmount, 12.2);
  assert.equal(item.originalCurrencyCode, "USD");
  assert.equal(item.foreignIofAmount, 2.3);
});

test("total da fatura soma BRL e IOF separado exatamente uma vez", () => {
  const iof: CardPurchase = {
    ...github,
    id: "iof",
    description: "IOF DESPESA NO EXTERIOR",
    currency: "BRL",
    original_amount: null,
    original_currency_code: null,
    amount_brl: 2.3,
    installment_amount: 2.3,
    total_amount: 2.3,
    foreign_iof_amount: null,
    transaction_role: "foreign_transaction_tax",
    entry_type: "tax",
  };
  assert.equal(calculateInvoiceAmounts([github, iof]).invoiceTotal, 67.92);
  const daily = calculateMovementSummaryByFilter(
    [normalizeCardPurchase(github), normalizeCardPurchase(iof)],
    "card",
  );
  assert.equal(daily.cards[0].value, 67.92);
  assert.equal(daily.cards[2].value, 67.92);
});

test("subtotal ignora original estrangeiro quando conversÃ£o falta", () => {
  assert.equal(persistedCardMovementAmountBrl({
    amount_brl: 12.2,
    installment_amount: 12.2,
    original_amount: 12.2,
    original_currency_code: "USD",
    conversion_source: "unknown",
  }), null);
});

test("normalizador expÃµe displayAmountBrl sem promover o original", () => {
  const value = normalizeCardMovementAmounts({
    amount: 12.2,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
  });
  assert.equal(value.displayAmountBrl, null);
  assert.equal(value.originalAmount, 12.2);
});

test("migration v2 possui dry-run, reparo e vÃ­nculo idempotente de IOF", () => {
  const sql = readFileSync(
    "supabase/migrations/202607280038_repair_foreign_card_amounts.sql",
    "utf8",
  );
  assert.match(sql, /backfill_foreign_card_amounts_v2/);
  assert.match(sql, /p_apply boolean default false/);
  assert.match(sql, /amountInAccountCurrency/);
  assert.match(sql, /related_foreign_purchase_id/);
  assert.match(sql, /foreign_transaction_tax/);
  assert.match(sql, /stillMissingConversion/);
});

test("drawer oferece correÃ§Ã£o e nÃ£o renderiza BRL quando indisponÃ­vel", () => {
  const source = readFileSync(
    "src/components/finance/movements-browser.tsx",
    "utf8",
  );
  assert.match(source, /correctForeignCardMovementAmounts/);
  assert.match(source, /Valor convertido indispon/);
  assert.match(source, /name="amount_brl"/);
  assert.match(source, /name="foreign_iof_amount"/);
});
