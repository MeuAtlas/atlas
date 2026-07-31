import type { IncomeExpenseListItem } from "./income-expenses-query";

export type IncomeExpenseOverviewSummary = {
  expectedIncome: number;
  receivedIncome: number;
  paidExpenses: number;
  remainingExpectedExpenses: number;
  totalExpectedCashExpenses: number;
  realizedResult: number;
  projectedResult: number;
  incomeProgressPercentage: number;
  expenseProgressPercentage: number;
  payrollDeductionsTotal: number;
  dataWarnings: string[];
};

export type CanonicalFinancialEvent = {
  id: string;
  kind: "income" | "expense";
  title: string;
  expectedDate: string | null;
  expectedAmount: number;
  realizedAmount: number;
  status: string;
  person: string | null;
  context: string;
  source: string | null;
  linkedTransactionsCount: number;
};

export type MonthlyCumulativePoint = {
  date: string;
  day: number;
  cumulativeIncome: number;
  cumulativeExpenses: number;
};

export type ExpenseContextDistributionItem = {
  key: "personal" | "household" | "dependents" | "work" | "travel";
  label: string;
  amount: number;
  percentage: number;
};

export type IncomeExpenseDashboard = {
  summary: IncomeExpenseOverviewSummary;
  cumulativeSeries: MonthlyCumulativePoint[];
  financialEvents: CanonicalFinancialEvent[];
  contextDistribution: ExpenseContextDistributionItem[];
  topIncome: Array<{ id: string; title: string; amount: number }>;
  topExpenses: Array<{ id: string; title: string; amount: number }>;
  warnings: string[];
};

const percentage = (value: number, total: number) =>
  total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;

export function getCanonicalFinancialEventsForMonth(
  items: IncomeExpenseListItem[],
): CanonicalFinancialEvent[] {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const id = item.occurrenceId ?? `${item.id}:${item.competenceMonth}`;
    if (seen.has(id) || item.isPayrollDeduction) return [];
    seen.add(id);
    return [{
      id,
      kind: item.direction,
      title: item.title,
      expectedDate: item.expectedDate,
      expectedAmount: item.expectedAmountCents,
      realizedAmount: item.realizedAmountCents,
      status: item.occurrenceStatus,
      person: item.personNames[0] ?? null,
      context: item.contextType,
      source: item.settlementSource,
      linkedTransactionsCount: item.creditsCount,
    }];
  }).sort((left, right) => {
    const priority = (status: string) => status === "overdue" ? 0
      : status.startsWith("partially") ? 1
      : ["projected", "expected", "pending"].includes(status) ? 2 : 3;
    return priority(left.status) - priority(right.status)
      || (left.expectedDate ?? "9999").localeCompare(right.expectedDate ?? "9999");
  });
}

export function getMonthlyIncomeExpenseCumulativeSeries(input: {
  month: string;
  items: IncomeExpenseListItem[];
}): MonthlyCumulativePoint[] {
  const [year, monthNumber] = input.month.slice(0, 7).split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const incomeByDay = new Map<number, number>();
  const expenseByDay = new Map<number, number>();
  for (const item of input.items) {
    if (item.isPayrollDeduction || item.realizedAmountCents <= 0) continue;
    const sourceDate = item.paymentDate ?? item.expectedDate;
    if (!sourceDate || sourceDate.slice(0, 7) !== input.month.slice(0, 7)) continue;
    const day = Number(sourceDate.slice(8, 10));
    const target = item.direction === "income" ? incomeByDay : expenseByDay;
    target.set(day, (target.get(day) ?? 0) + item.realizedAmountCents);
  }
  let cumulativeIncome = 0;
  let cumulativeExpenses = 0;
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    cumulativeIncome += incomeByDay.get(day) ?? 0;
    cumulativeExpenses += expenseByDay.get(day) ?? 0;
    return {
      date: `${input.month.slice(0, 7)}-${String(day).padStart(2, "0")}`,
      day,
      cumulativeIncome,
      cumulativeExpenses,
    };
  });
}

export function getExpenseContextDistribution(
  expenses: IncomeExpenseListItem[],
): ExpenseContextDistributionItem[] {
  const totals = new Map<ExpenseContextDistributionItem["key"], number>();
  for (const item of expenses) {
    if (item.isPayrollDeduction || item.realizedAmountCents <= 0) continue;
    const key = item.personNames.length
      ? "dependents"
      : item.contextType === "household" || item.contextType === "work" || item.contextType === "travel"
        ? item.contextType
        : "personal";
    totals.set(key, (totals.get(key) ?? 0) + item.realizedAmountCents);
  }
  const labels = {
    personal: "Pessoal",
    household: "Casa",
    dependents: "Dependentes",
    work: "Trabalho",
    travel: "Viagem",
  } as const;
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const keys: ExpenseContextDistributionItem["key"][] = [
    "personal", "household", "dependents", "work", "travel",
  ];
  return keys.filter(key => totals.has(key)).map(key => ({
    key,
    label: labels[key],
    amount: totals.get(key) ?? 0,
    percentage: percentage(totals.get(key) ?? 0, total),
  }));
}

export function getIncomeExpenseDashboard(input: {
  month: string;
  incomes: IncomeExpenseListItem[];
  expenses: IncomeExpenseListItem[];
  payrollDeductions: IncomeExpenseListItem[];
}): IncomeExpenseDashboard {
  const expectedIncome = input.incomes.reduce((sum, item) => sum + item.expectedAmountCents, 0);
  const receivedIncome = input.incomes.reduce((sum, item) => sum + item.realizedAmountCents, 0);
  const totalExpectedCashExpenses = input.expenses.reduce((sum, item) => sum + item.expectedAmountCents, 0);
  const paidExpenses = input.expenses.reduce((sum, item) => sum + item.realizedAmountCents, 0);
  const remainingExpectedExpenses = Math.max(0, totalExpectedCashExpenses - paidExpenses);
  const payrollDeductionsTotal = input.payrollDeductions.reduce(
    (sum, item) => sum + (item.realizedAmountCents || item.expectedAmountCents), 0,
  );
  const items = [...input.incomes, ...input.expenses];
  return {
    summary: {
      expectedIncome,
      receivedIncome,
      paidExpenses,
      remainingExpectedExpenses,
      totalExpectedCashExpenses,
      realizedResult: receivedIncome - paidExpenses,
      projectedResult: expectedIncome - totalExpectedCashExpenses,
      incomeProgressPercentage: percentage(receivedIncome, expectedIncome),
      expenseProgressPercentage: percentage(paidExpenses, totalExpectedCashExpenses),
      payrollDeductionsTotal,
      dataWarnings: [],
    },
    cumulativeSeries: getMonthlyIncomeExpenseCumulativeSeries({ month: input.month, items }),
    financialEvents: getCanonicalFinancialEventsForMonth(items),
    contextDistribution: getExpenseContextDistribution(input.expenses),
    topIncome: input.incomes.filter(item => item.realizedAmountCents > 0)
      .sort((a, b) => b.realizedAmountCents - a.realizedAmountCents).slice(0, 5)
      .map(item => ({ id: item.id, title: item.title, amount: item.realizedAmountCents })),
    topExpenses: input.expenses.filter(item => item.realizedAmountCents > 0)
      .sort((a, b) => b.realizedAmountCents - a.realizedAmountCents).slice(0, 5)
      .map(item => ({ id: item.id, title: item.title, amount: item.realizedAmountCents })),
    warnings: [],
  };
}
