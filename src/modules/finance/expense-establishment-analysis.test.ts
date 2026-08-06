import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEstablishmentAnalyses,
  median,
  sortEstablishmentAnalyses,
  type EstablishmentTransaction,
} from "./expense-establishment-analysis";

const establishment = { id: "market", name: "Mercado", categoryName: "Alimentação", aliases: ["MERCADO"] };
const row = (date: string, amountCents: number, extra: Partial<EstablishmentTransaction> = {}): EstablishmentTransaction => ({
  id: crypto.randomUUID(), establishmentId: "market", date, amountCents, description: "Compra",
  sourceLabel: "Santander", bankDirection: "outflow", transactionRole: "consumption",
  transactionType: "expense", status: "realized", ...extra,
});

test("calcula mediana mensal e frequência sem incluir o mês comparado", () => {
  const [result] = buildEstablishmentAnalyses({
    establishments: [establishment],
    transactions: [
      row("2026-01-10", 10_000), row("2026-02-10", 20_000),
      row("2026-03-10", 30_000), row("2026-04-10", 60_000),
    ],
    selectedMonth: "2026-04",
    currentMonth: "2026-08",
  });
  assert.equal(result.monthTotalCents, 60_000);
  assert.equal(result.monthCount, 1);
  assert.equal(result.medianMonthlyCents, 20_000);
  assert.equal(result.medianFrequency, 1);
  assert.equal(result.comparison, "above");
});

test("exclui fatura, transferência e mantém estorno vinculado", () => {
  const [result] = buildEstablishmentAnalyses({
    establishments: [establishment],
    transactions: [
      row("2026-01-10", 10_000), row("2026-02-10", 10_000), row("2026-03-10", 10_000),
      row("2026-04-10", 10_000),
      row("2026-04-11", 99_000, { transactionRole: "invoice_payment" }),
      row("2026-04-12", 99_000, { transactionRole: "transfer" }),
      row("2026-04-13", 2_000, { bankDirection: "inflow", transactionRole: "refund" }),
    ],
    selectedMonth: "2026-04",
    currentMonth: "2026-08",
  });
  assert.equal(result.monthTotalCents, 8_000);
  assert.equal(result.monthCount, 2);
});

test("exige três meses e ordena sem movimentação depois", () => {
  const rows = buildEstablishmentAnalyses({
    establishments: [establishment, { ...establishment, id: "empty", name: "Zeta" }],
    transactions: [row("2026-04-10", 10_000)],
    selectedMonth: "2026-04",
    currentMonth: "2026-08",
  });
  assert.equal(rows[0].medianMonthlyCents, null);
  assert.equal(sortEstablishmentAnalyses(rows, "highest").map(item => item.id).join(","), "market,empty");
  assert.equal(median([1, 4, 8, 10]), 6);
});
