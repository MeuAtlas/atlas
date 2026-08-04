import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNextInstallmentOccurrence,
  buildPostedInstallmentOccurrence,
  calculateOpenCardCycleBreakdown,
  classifyOpenCardCycleMovement,
  matchInstallmentTransactionToOccurrence,
  projectInstallmentSeed,
  type PreviousInvoiceInstallment,
} from "./open-card-cycle";

const previous: PreviousInvoiceInstallment = {
  sourceId: "pdf-entry-1",
  merchantNormalized: "BRAZA CELLSHOP SOLAR",
  description: "Braza Cellshop Solar",
  amount: 563.95,
  currencyCode: "BRL",
  cardId: "card-5718",
  cardLastFour: "5718",
  originalDate: "2026-06-24",
  currentInstallment: 1,
  totalInstallments: 12,
  confidence: 0.97,
};

test("preserva total líquido e separa compras, parcelas, encargos e créditos", () => {
  const result = calculateOpenCardCycleBreakdown({
    confirmedOpenTotal: 7082.45,
    installmentsDataStatus: "available",
    movements: [
      { id: "purchase", amount: 3851.19, effect: "debit" },
      {
        id: "posted", amount: 352.81, effect: "debit",
        entryType: "installment_purchase", installmentNumber: 1,
        installmentTotal: 5,
      },
      {
        id: "projection", amount: 2133.19, effect: "debit",
        source: "projection", reconciliationStatus: "projected_only",
      },
      { id: "tax", amount: 16, effect: "debit", entryType: "tax" },
      { id: "refund", amount: 10, effect: "credit", entryType: "refund" },
    ],
  });
  assert.equal(result.newPurchasesTotal + result.postedInstallmentsTotal, 4204);
  assert.equal(result.postedInstallmentsTotal, 352.81);
  assert.equal(result.projectedUnpostedInstallmentsTotal, 2133.19);
  assert.equal(result.detailedTotal, 6343.19);
  assert.equal(result.reconciliationDifference, 739.26);
});

test("parcela real sai de compra nova sem alterar o total detalhado", () => {
  const item = classifyOpenCardCycleMovement({
    id: "installment", amount: 102.99, effect: "debit",
    entryType: "installment_purchase", installmentNumber: 1,
    installmentTotal: 5,
  });
  assert.equal(item.classification, "posted_installment");
});

test("IOF e tarifa genÃ©ricos sÃ£o separados das compras novas", () => {
  const common = {
    amount: 10,
    effect: "debit" as const,
    entryType: "purchase",
  };
  assert.equal(classifyOpenCardCycleMovement({
    ...common,
    id: "iof",
    description: "IOF DESPESA NO EXTERIOR",
  }).classification, "tax");
  assert.equal(classifyOpenCardCycleMovement({
    ...common,
    id: "fee",
    description: "ANUIDADE DIFERENCIADA",
  }).classification, "fee");
});

test("erro de ocorrências não transforma indisponibilidade em diferença zero", () => {
  const result = calculateOpenCardCycleBreakdown({
    movements: [],
    confirmedOpenTotal: 7082.45,
    installmentsDataStatus: "unavailable",
  });
  assert.equal(result.projectedUnpostedInstallmentsTotal, 0);
  assert.equal(result.reconciliationDifference, null);
});

test("zero confirmado permanece distinguível de erro", () => {
  const result = calculateOpenCardCycleBreakdown({
    movements: [],
    confirmedOpenTotal: 0,
    installmentsDataStatus: "confirmed_zero",
  });
  assert.equal(result.detailedTotal, 0);
  assert.equal(result.reconciliationDifference, 0);
});

test("parcela com data original antiga entra pela competência de agosto", () => {
  const occurrence = buildNextInstallmentOccurrence(
    previous,
    "2026-08-01",
    10,
  );
  assert.ok(occurrence);
  assert.equal(occurrence.originalDate, "2026-06-24");
  assert.equal(occurrence.competenceMonth, "2026-08-01");
  assert.equal(occurrence.installmentNumber, 2);
});

test("correção de centavos preserva a identidade do mesmo parcelamento", () => {
  const beforeCorrection = buildPostedInstallmentOccurrence({
    ...previous,
    amount: 75.15,
    originalDate: "2025-09-14",
    currentInstallment: 2,
    totalInstallments: 13,
  }, "2025-11-01", 10)!;
  const afterCorrection = buildPostedInstallmentOccurrence({
    ...previous,
    amount: 75.07,
    originalDate: "2025-09-14",
    currentInstallment: 3,
    totalInstallments: 13,
  }, "2025-12-01", 10)!;
  assert.equal(
    beforeCorrection.matchingFingerprint,
    afterCorrection.matchingFingerprint,
  );
  assert.notEqual(beforeCorrection.amount, afterCorrection.amount);
});

test("compras distintas no mesmo estabelecimento continuam separadas pela data original", () => {
  const first = buildPostedInstallmentOccurrence({
    ...previous,
    originalDate: "2025-09-14",
    currentInstallment: 1,
    totalInstallments: 13,
  }, "2025-10-01", 10)!;
  const second = buildPostedInstallmentOccurrence({
    ...previous,
    originalDate: "2025-09-15",
    currentInstallment: 1,
    totalInstallments: 13,
  }, "2025-10-01", 10)!;
  assert.notEqual(first.matchingFingerprint, second.matchingFingerprint);
});

test("última parcela não gera ocorrência seguinte", () => {
  assert.equal(buildNextInstallmentOccurrence({
    ...previous,
    currentInstallment: 12,
  }, "2026-08-01", 10), null);
});

test("parcela 01/N cria a atual e todos os compromissos futuros", () => {
  const first = buildPostedInstallmentOccurrence({
    ...previous,
    sourceId: "new-luz",
    currentInstallment: 1,
    totalInstallments: 5,
    amount: 102.99,
  }, "2026-08-01", 10)!;
  const occurrences = projectInstallmentSeed(first, 10);
  assert.deepEqual(
    occurrences.map(item => [
      item.installmentNumber,
      item.competenceMonth,
      item.status,
    ]),
    [
      [1, "2026-08-01", "posted"],
      [2, "2026-09-01", "projected"],
      [3, "2026-10-01", "projected"],
      [4, "2026-11-01", "projected"],
      [5, "2026-12-01", "projected"],
    ],
  );
});

test("lançamento real concilia exatamente com ocorrência sem duplicar", () => {
  const occurrence = buildNextInstallmentOccurrence(
    previous,
    "2026-08-01",
    10,
  )!;
  const match = matchInstallmentTransactionToOccurrence({
    id: "pluggy-2",
    amount: 563.95,
    effect: "debit",
    merchantNormalized: "BRAZA CELLSHOP SOLAR",
    installmentNumber: 2,
    installmentTotal: 12,
    cardLastFour: "5718",
    competenceMonth: "2026-08-01",
  }, occurrence);
  assert.equal(match.status, "exact_match");
  assert.equal(match.score, 100);
});

test("valor ou cartão divergente exige divergência explícita", () => {
  const occurrence = buildNextInstallmentOccurrence(
    previous,
    "2026-08-01",
    10,
  )!;
  assert.equal(matchInstallmentTransactionToOccurrence({
    id: "wrong",
    amount: 100,
    effect: "debit",
    merchantNormalized: "BRAZA CELLSHOP SOLAR",
    cardLastFour: "5991",
  }, occurrence).status, "divergent");
});

test("moeda estrangeira usa somente o valor convertido em BRL", () => {
  const result = calculateOpenCardCycleBreakdown({
    confirmedOpenTotal: null,
    installmentsDataStatus: "confirmed_zero",
    movements: [{
      id: "international",
      amount: 266.27,
      effect: "debit",
      currencyCode: "BRL",
      description: "Compra internacional com original em USD",
    }],
  });
  assert.equal(result.detailedTotal, 266.27);
});
