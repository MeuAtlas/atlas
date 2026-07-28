import assert from "node:assert/strict";
import test from "node:test";
import { calculateBankAccountCashFlow } from "./bank-cash-flow";

test("fluxo bancário soma créditos e débitos em centavos", () => {
  const summary = calculateBankAccountCashFlow([
    {
      id: "income",
      date: "2026-07-01",
      amount: 48_923.92,
      effect: "inflow",
    },
    {
      id: "ordinary-debits",
      date: "2026-07-02",
      amount: 42_928.10,
      effect: "outflow",
    },
    {
      id: "invoice-payment",
      date: "2026-07-03",
      amount: 11_517.22,
      effect: "outflow",
    },
    {
      id: "card-purchase",
      date: "2026-07-03",
      amount: 500,
      effect: "neutral",
    },
  ]);

  assert.equal(summary.totalInflows, 48_923.92);
  assert.equal(summary.totalOutflows, 54_445.32);
  assert.equal(summary.netMovement, -5_521.40);
  assert.equal(summary.inflowCount, 1);
  assert.equal(summary.outflowCount, 2);
  assert.equal(summary.largestInflow, 48_923.92);
  assert.equal(summary.largestOutflow, 42_928.10);
  assert.equal(summary.dailySeries.at(-1)?.cumulativeOutflow, 54_445.32);
});

test("flags de consumo não participam do DTO de fluxo físico", () => {
  const summary = calculateBankAccountCashFlow([
    {
      id: "invoice-payment",
      date: "2026-07-10",
      amount: 1_000,
      effect: "outflow",
      included: true,
    },
    {
      id: "ignored-bank-row",
      date: "2026-07-10",
      amount: 2_000,
      effect: "outflow",
      included: false,
    },
  ]);
  assert.equal(summary.totalOutflows, 1_000);
  assert.equal(summary.outflowCount, 1);
});
