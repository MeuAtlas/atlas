import assert from "node:assert/strict";
import test from "node:test";
import {
  deduplicateCardMovements,
  getClosedCardCycleMovements,
  getOpenCardCycleMovements,
  resolveInvoiceEntryEffect,
  summarizeCardCycleMovements,
  type CardCycleMovement,
} from "./card-cycle-movements";

function movement(
  patch: Partial<CardCycleMovement> = {},
): CardCycleMovement {
  return {
    id: "movement",
    cycleId: "cycle-open",
    billId: null,
    source: "pluggy",
    sourceRecordId: "pluggy-1",
    reconciledSourceIds: [],
    cardId: "card-account",
    instrumentId: "instrument-main",
    cardLabel: "final 5718",
    transactionDate: "2026-07-20",
    competenceMonth: "2026-08-01",
    description: "LOJA TESTE",
    merchantNormalized: "LOJA TESTE",
    amount: 100,
    amountBrl: 100,
    originalAmount: null,
    originalCurrencyCode: null,
    exchangeRate: null,
    foreignIofAmount: null,
    conversionSource: null,
    convertedAt: null,
    postingDate: null,
    entryType: "purchase",
    installmentNumber: null,
    installmentTotal: null,
    providerTransactionId: "provider-1",
    invoiceEntryId: null,
    reconciliationStatus: "pluggy_only",
    effect: "debit",
    ...patch,
  };
}

test("efeitos da fatura excluem resumo, saldo, pagamento e informação futura", () => {
  for (const entryType of [
    "payment",
    "previous_balance",
    "informational",
    "subtotal",
    "official_total",
    "future_balance",
    "unknown",
  ]) {
    assert.equal(resolveInvoiceEntryEffect(entryType, 100), "exclude");
  }
});

test("compra, parcela, IOF, anuidade, juros e ajuste de débito aumentam a fatura", () => {
  for (const entryType of [
    "purchase",
    "installment_purchase",
    "fee",
    "interest",
    "tax",
    "adjustment_debit",
  ]) {
    assert.equal(resolveInvoiceEntryEffect(entryType, 100), "debit");
  }
});

test("crédito, estorno e ajuste negativo reduzem a fatura", () => {
  assert.equal(resolveInvoiceEntryEffect("credit", -100), "credit");
  assert.equal(resolveInvoiceEntryEffect("refund", -100), "credit");
  assert.equal(resolveInvoiceEntryEffect("adjustment", -100), "credit");
});

test("PDF e Pluggy conciliados pelo provider transaction contam uma vez e PDF vence", () => {
  const pluggy = movement();
  const pdf = movement({
    id: "pdf",
    source: "pdf",
    sourceRecordId: "entry-1",
    providerTransactionId: "provider-1",
    invoiceEntryId: "entry-1",
    reconciliationStatus: "matched",
    amount: 65.62,
    amountBrl: 65.62,
    originalAmount: 12.2,
    originalCurrencyCode: "USD",
    exchangeRate: 5.3787,
    foreignIofAmount: .43,
    conversionSource: "pdf",
  });
  pluggy.amount = 65.62;
  pluggy.amountBrl = 65.62;
  const result = deduplicateCardMovements([pluggy, pdf]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "pdf");
  assert.equal(result[0].reconciliationStatus, "matched");
  assert.equal(result[0].amountBrl, 65.62);
  assert.equal(result[0].originalAmount, 12.2);
  assert.equal(result[0].originalCurrencyCode, "USD");
  assert.ok(result[0].reconciledSourceIds.includes("pluggy-1"));
});

test("fingerprint conservador deduplica PDF e Pluggy sem vínculo persistido", () => {
  const result = deduplicateCardMovements([
    movement({ providerTransactionId: null }),
    movement({
      id: "pdf",
      source: "pdf",
      sourceRecordId: "entry-1",
      providerTransactionId: null,
      transactionDate: "2026-07-21",
      reconciliationStatus: "pdf_only",
    }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "pdf");
});

test("deduplicates conflicting Pluggy installments from one same-day purchase", () => {
  const result = deduplicateCardMovements([
    movement({
      id: "first-installment",
      sourceRecordId: "first-installment",
      providerTransactionId: "provider-first",
      transactionDate: "2026-07-15",
      description: "On Sportswear",
      merchantNormalized: "ON SPORTSWEAR",
      amount: 124.91,
      amountBrl: 124.91,
      installmentNumber: 1,
      installmentTotal: 8,
    }),
    movement({
      id: "sixth-installment",
      sourceRecordId: "sixth-installment",
      providerTransactionId: "provider-sixth",
      transactionDate: "2026-07-15",
      description: "On Sportswear",
      merchantNormalized: "ON SPORTSWEAR",
      amount: 124.91,
      amountBrl: 124.91,
      installmentNumber: 6,
      installmentTotal: 8,
    }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].amount, 124.91);
});

test("parcela projetada conciliada com lançamento real não duplica", () => {
  const projection = movement({
    id: "projection",
    source: "projection",
    sourceRecordId: "occurrence-7",
    providerTransactionId: null,
    transactionDate: "2026-08-10",
    entryType: "installment_purchase",
    installmentNumber: 7,
    installmentTotal: 10,
    reconciliationStatus: "projected_only",
  });
  const posted = movement({
    entryType: "installment_purchase",
    installmentNumber: 7,
    installmentTotal: 10,
  });
  const result = deduplicateCardMovements([projection, posted]);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "pluggy");
  assert.equal(result[0].reconciliationStatus, "matched");
});

test("ciclo aberto sem bill soma compras Pluggy, projeções e créditos", () => {
  const result = summarizeCardCycleMovements([
    movement({ amount: 500 }),
    movement({
      id: "projection",
      source: "projection",
      sourceRecordId: "occurrence",
      providerTransactionId: null,
      amount: 200,
      reconciliationStatus: "projected_only",
    }),
    movement({
      id: "credit",
      sourceRecordId: "credit",
      providerTransactionId: "credit",
      amount: 50,
      entryType: "credit",
      effect: "credit",
    }),
  ]);
  assert.deepEqual(result, {
    launchedPurchases: 500,
    projectedInstallments: 200,
    credits: 50,
    projection: 650,
  });
});

test("cartões principal e adicional permanecem no consolidado e distinguíveis", () => {
  const result = deduplicateCardMovements([
    movement(),
    movement({
      id: "additional",
      sourceRecordId: "pluggy-2",
      providerTransactionId: "provider-2",
      instrumentId: "instrument-additional",
      cardLabel: "final 6579",
    }),
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(
    result.map(item => item.instrumentId).sort(),
    ["instrument-additional", "instrument-main"],
  );
});

test("seletores de ciclo mantêm PDF como base fechada e o removem da aberta", () => {
  const pdf = movement({
    id: "pdf",
    source: "pdf",
    sourceRecordId: "entry",
    providerTransactionId: null,
    reconciliationStatus: "pdf_only",
  });
  const pluggy = movement({
    description: "OUTRA COMPRA",
    merchantNormalized: "OUTRA COMPRA",
  });
  assert.deepEqual(
    getOpenCardCycleMovements([pdf, pluggy]).map(item => item.source),
    ["pluggy"],
  );
  assert.deepEqual(
    getClosedCardCycleMovements([pdf, pluggy])
      .map(item => item.source)
      .sort(),
    ["pdf", "pluggy"],
  );
});
