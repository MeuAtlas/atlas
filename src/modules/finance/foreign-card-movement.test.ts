import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMoneyByCurrency,
  implicitExchangeRate,
  normalizeForeignCardMovement,
} from "./foreign-card-movement";

test("formata BRL, USD e EUR dinamicamente", () => {
  assert.match(formatMoneyByCurrency(65.62, "BRL"), /R\$\s*65,62/);
  assert.match(formatMoneyByCurrency(12.2, "USD"), /US\$\s*12,20/);
  assert.match(formatMoneyByCurrency(10, "EUR"), /€\s*10,00/);
});

test("Pluggy usa amountInAccountCurrency no total e preserva o USD original", () => {
  const normalized = normalizeForeignCardMovement({
    amount: 12.2,
    currencyCode: "USD",
    amountInAccountCurrency: 65.62,
    source: "pluggy",
  });
  assert.deepEqual(normalized, {
    displayAmountBrl: 65.62,
    amountBrl: 65.62,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
    exchangeRate: null,
    iofAmountBrl: null,
    isForeignTransaction: true,
    conversionSource: "pluggy",
  });
});

test("valor original estrangeiro nunca vira BRL por fallback", () => {
  const normalized = normalizeForeignCardMovement({
    amount: 12.2,
    currencyCode: "USD",
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
    source: "pluggy",
  });
  assert.equal(normalized.amountBrl, null);
  assert.equal(normalized.displayAmountBrl, null);
  assert.equal(normalized.originalAmount, 12.2);
});

test("valor persistido suspeito igual ao original Ã© descartado", () => {
  const normalized = normalizeForeignCardMovement({
    persistedAmountBrl: 12.2,
    amount: 12.2,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
    conversionSource: "unknown",
  });
  assert.equal(normalized.amountBrl, null);
});

test("prioridade Ã© PDF, Pluggy explÃ­cita, manual, persistido e derivado", () => {
  assert.equal(normalizeForeignCardMovement({
    pdfAmountBrl: 65.62,
    providerAmountBrl: 64,
    manualAmountBrl: 63,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
  }).amountBrl, 65.62);
  assert.equal(normalizeForeignCardMovement({
    providerAmountBrl: 65.62,
    manualAmountBrl: 63,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
  }).amountBrl, 65.62);
  assert.equal(normalizeForeignCardMovement({
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
    exchangeRate: 5.3787,
  }).amountBrl, 65.62);
});

test("PDF preserva EUR, cotação explícita e IOF sem somá-los ao convertido", () => {
  const normalized = normalizeForeignCardMovement({
    amountBrl: 54,
    originalAmount: 10,
    originalCurrencyCode: "EUR",
    exchangeRate: 5.4,
    iofAmountBrl: 1.89,
    source: "pdf",
  });
  assert.equal(normalized.amountBrl, 54);
  assert.equal(normalized.originalAmount, 10);
  assert.equal(normalized.exchangeRate, 5.4);
  assert.equal(normalized.iofAmountBrl, 1.89);
  assert.equal(normalized.conversionSource, "pdf");
});

test("cotação explícita mantém precisão suficiente para auditoria", () => {
  const value = normalizeForeignCardMovement({
    amountBrl: 21.55,
    originalAmount: 4,
    originalCurrencyCode: "USD",
    exchangeRate: 5.3873,
    source: "pdf",
  });
  assert.equal(value.exchangeRate, 5.3873);
});

test("não infere moeda pelo merchant nem aceita valor original zero", () => {
  const normalized = normalizeForeignCardMovement({
    amountBrl: 65.62,
    originalAmount: 0,
    description: "Github, Inc.",
  });
  assert.equal(normalized.isForeignTransaction, false);
  assert.equal(normalized.originalAmount, null);
  assert.equal(normalized.originalCurrencyCode, null);
});

test("descrição só é derivada quando contém moeda e valor explícitos", () => {
  const normalized = normalizeForeignCardMovement({
    amountBrl: 65.62,
    description: "Github, Inc. US$ 12,20",
  });
  assert.equal(normalized.originalAmount, 12.2);
  assert.equal(normalized.originalCurrencyCode, "USD");
  assert.equal(normalized.conversionSource, "unknown");
});

test("taxa implícita é calculada separadamente da cotação oficial", () => {
  const normalized = normalizeForeignCardMovement({
    amountBrl: 65.62,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
  });
  assert.equal(normalized.exchangeRate, null);
  assert.equal(implicitExchangeRate(normalized), 5.3787);
});

test("moeda desconhecida com ISO válido é preservada", () => {
  const normalized = normalizeForeignCardMovement({
    amountBrl: 100,
    originalAmount: 2000,
    originalCurrencyCode: "JPY",
  });
  assert.equal(normalized.originalCurrencyCode, "JPY");
  assert.match(formatMoneyByCurrency(2000, "JPY"), /2\.000,00/);
});
