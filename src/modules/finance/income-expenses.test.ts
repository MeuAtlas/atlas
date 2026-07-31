import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateIncomeCreditsByMonth,
  calculateHistoricalMonthlyIncomeMedian,
  calculateIncomeExpenseOverview,
  median,
  resolveExpectedBusinessDate,
  resolveIncomeExpectedAmount,
  resolveMonthlyIncomeOccurrenceStatus,
  type IncomeMonthlyTotal,
} from "./income-expenses";

const month = (
  value: string,
  totalCents: number,
  creditsCount = 1,
  options: Partial<IncomeMonthlyTotal> = {},
): IncomeMonthlyTotal => ({
  month: `${value}-01`,
  totalCents,
  creditsCount,
  hasCoverage: true,
  isComplete: true,
  ...options,
});

test("agrupa vários créditos em um único total mensal", () => {
  const result = aggregateIncomeCreditsByMonth([
    { date: "2026-01-05", amountCents: 1_050_000 },
    { date: "2026-01-15", amountCents: 120_000 },
    { date: "2026-01-25", amountCents: 130_000 },
    { date: "2026-02-05", amountCents: 1_080_000 },
    { date: "2026-02-20", amountCents: 160_000 },
  ]);
  assert.deepEqual(result.map(item => [
    item.month,
    item.totalCents,
    item.creditsCount,
  ]), [
    ["2026-01-01", 1_300_000, 3],
    ["2026-02-01", 1_240_000, 2],
  ]);
});

test("mediana usa totais mensais ímpares e pares", () => {
  assert.equal(median([1_300_000, 1_240_000, 1_300_000]), 1_300_000);
  assert.equal(median([1_200_000, 1_300_000, 1_400_000, 1_500_000]), 1_350_000);
});

test("fixture de 12 meses calcula mediana, média e total de créditos", () => {
  const totals = [
    month("2025-07", 1_300_000, 3),
    month("2025-08", 1_240_000, 2),
    month("2025-09", 1_300_000, 2),
    month("2025-10", 1_325_000, 3),
    month("2025-11", 1_290_000, 2),
    month("2025-12", 1_410_000, 3),
    month("2026-01", 1_315_000, 2),
    month("2026-02", 1_360_000, 3),
    month("2026-03", 1_280_000, 2),
    month("2026-04", 1_335_000, 3),
    month("2026-05", 1_320_000, 2),
    month("2026-06", 1_345_000, 3),
  ];
  const result = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: totals,
    endMonth: "2026-07-01",
  });
  assert.equal(result.monthsAvailable, 12);
  assert.equal(result.medianAmount, 1_317_500);
  assert.equal(result.averageAmount, 1_318_333);
  assert.equal(result.totalCredits, 30);
  assert.equal(result.confidence, "high");
});

test("usa oito ou cinco meses quando são os únicos disponíveis", () => {
  const totals = Array.from({ length: 8 }, (_, index) =>
    month(`2026-${String(index + 1).padStart(2, "0")}`, 100_000 + index)
  );
  assert.equal(calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: totals,
    endMonth: "2026-09-01",
  }).monthsAvailable, 8);
  assert.equal(calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: totals.slice(0, 5),
    endMonth: "2026-09-01",
  }).monthsAvailable, 5);
});

test("menos de três meses produz estimativa provisória e aviso", () => {
  const result = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: [month("2026-04", 100_000), month("2026-05", 120_000)],
    endMonth: "2026-07-01",
  });
  assert.equal(result.medianAmount, 110_000);
  assert.equal(result.confidence, "low");
  assert.match(result.warning ?? "", /pouco histórico/i);
});

test("mês atual incompleto e mês sem cobertura não entram na mediana", () => {
  const result = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: [
      month("2026-05", 100_000),
      month("2026-06", 0, 0, { hasCoverage: false }),
      month("2026-07", 900_000, 1, { isComplete: false }),
    ],
    endMonth: "2026-07-01",
  });
  assert.deepEqual(result.monthlyTotals.map(item => item.month), ["2026-05-01"]);
});

test("zero só entra quando mês está completo, coberto e receita ativa", () => {
  const result = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: [
      month("2026-03", 0, 0),
      month("2026-04", 100_000),
      month("2026-05", 0, 0),
    ],
    activeFrom: "2026-04-01",
    endMonth: "2026-06-01",
    includeZeroMonths: true,
  });
  assert.deepEqual(result.monthlyTotals.map(item => item.totalCents), [100_000, 0]);
});

test("override mensal tem prioridade e mês seguinte volta à mediana", () => {
  const statistics = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: [month("2026-05", 1_300_000), month("2026-06", 1_350_000)],
    endMonth: "2026-07-01",
  });
  const august = resolveIncomeExpectedAmount({
    manualOverrideCents: 1_410_000,
    statistics,
  });
  const september = resolveIncomeExpectedAmount({ statistics });
  assert.equal(august.amount, 1_410_000);
  assert.equal(august.source, "manual_override");
  assert.equal(september.amount, 1_325_000);
  assert.equal(september.source, "historical_median");
});

test("valor fixo precede mediana e último valor é fallback explícito", () => {
  const statistics = calculateHistoricalMonthlyIncomeMedian({
    monthlyTotals: [month("2026-05", 200_000)],
    endMonth: "2026-07-01",
  });
  assert.equal(resolveIncomeExpectedAmount({
    fixedAmountCents: 180_000,
    statistics,
  }).source, "fixed_definition");
  assert.equal(resolveIncomeExpectedAmount({
    lastKnownAmountCents: 150_000,
  }).source, "system_fallback");
});

test("status acumula créditos e distingue parcial, acima e abaixo", () => {
  assert.equal(resolveMonthlyIncomeOccurrenceStatus({
    expectedAmountCents: 1_325_000,
    receivedAmountCents: 1_080_000,
    monthComplete: false,
  }), "partially_received");
  assert.equal(resolveMonthlyIncomeOccurrenceStatus({
    expectedAmountCents: 1_325_000,
    receivedAmountCents: 2_500_000,
    monthComplete: true,
  }), "above_expected");
  assert.equal(resolveMonthlyIncomeOccurrenceStatus({
    expectedAmountCents: 1_325_000,
    receivedAmountCents: 1_000_000,
    monthComplete: true,
  }), "below_expected");
});

test("previsão e realizado permanecem separados no resultado", () => {
  const overview = calculateIncomeExpenseOverview({
    incomes: [{ expectedCents: 1_325_000, receivedCents: 1_100_000 }],
    expenses: [{ expectedCents: 500_000, paidCents: 300_000 }],
  });
  assert.equal(overview.projectedBalanceCents, 825_000);
  assert.equal(overview.realizedBalanceCents, 800_000);
});

test("quinto dia útil e data sem dia específico", () => {
  assert.equal(resolveExpectedBusinessDate({
    month: "2026-08-01",
    rule: "fifth_business_day",
  }), "2026-08-07");
  assert.equal(resolveExpectedBusinessDate({
    month: "2026-08-01",
    rule: "unspecified_in_month",
  }), null);
});

test("feriado é abstraído no cálculo de dia útil", () => {
  assert.equal(resolveExpectedBusinessDate({
    month: "2026-09-01",
    rule: "first_business_day",
    holidays: ["2026-09-01"],
  }), "2026-09-02");
});

test("migration cria agregação múltipla, migra legado e protege workspace", () => {
  const migration = readFileSync(join(
    process.cwd(),
    "supabase/migrations/202607300064_income_expenses_monthly_aggregation.sql",
  ), "utf8");
  assert.match(migration, /create table if not exists public\.financial_occurrence_transactions/);
  assert.match(migration, /unique \(transaction_id\)/);
  assert.match(migration, /link_source.*historical_backfill/);
  assert.match(migration, /insert into public\.financial_occurrence_transactions/);
  assert.match(migration, /financial_occurrence_transaction_scope_mismatch/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /financial_occurrence_transactions_read/);
  assert.match(migration, /financial_occurrence_transactions_write/);
});

test("sincronização reconcilia receitas mesmo como etapa opcional", () => {
  const sync = readFileSync(
    join(process.cwd(), "src/lib/pluggy/sync.ts"),
    "utf8",
  );
  assert.match(sync, /reconcileHistoricalIncomeTransactions/);
  assert.match(sync, /income_reconciliation/);
  assert.match(sync, /As movimentações foram preservadas/);
});

test("interface usa Receitas e Despesas e rota antiga redireciona", () => {
  const tabs = readFileSync(
    join(process.cwd(), "src/components/finance/finance-tabs.tsx"),
    "utf8",
  );
  const legacy = readFileSync(
    join(process.cwd(), "src/app/financeiro/compromissos/page.tsx"),
    "utf8",
  );
  const workspace = readFileSync(join(
    process.cwd(),
    "src/components/finance/income-expenses/income-expenses-workspace.tsx",
  ), "utf8");
  assert.match(tabs, /Receitas e Despesas/);
  assert.match(tabs, /financeiro\/receitas-despesas/);
  assert.match(legacy, /permanentRedirect/);
  assert.match(workspace, /Visão geral/);
  assert.match(workspace, /Receitas/);
  assert.match(workspace, /Despesas/);
  assert.match(workspace, /Pessoas e dependentes/);
  assert.match(workspace, /Calcular pelo histórico bancário/);
});

test("detalhe da despesa mostra pagamento e contexto sem campos técnicos", () => {
  const workspace = readFileSync(join(
    process.cwd(),
    "src/components/finance/income-expenses/income-expenses-workspace.tsx",
  ), "utf8");
  const query = readFileSync(join(
    process.cwd(),
    "src/modules/finance/income-expenses-query.ts",
  ), "utf8");
  assert.match(workspace, /Como esta despesa foi registrada/);
  assert.match(workspace, /Forma de pagamento/);
  assert.match(workspace, /Pago por/);
  assert.match(workspace, /Vencimento/);
  assert.match(workspace, /Recorrência/);
  assert.match(workspace, /Origem não vinculada/);
  assert.match(query, /financial_accounts\(name,institution_name\)/);
  assert.match(query, /credit_cards\(name,last_four_digits\)/);
  assert.match(query, /linked_transaction_id/);
});
