export type FinancialFlowDirection = "income" | "expense";
export type IncomeEstimationMethod =
  | "fixed"
  | "historical_median"
  | "manual";
export type IncomeAggregationMode = "single_occurrence" | "monthly_total";
export type ExpectedDateRule =
  | "fixed_day"
  | "first_business_day"
  | "fifth_business_day"
  | "last_business_day"
  | "unspecified_in_month";
export type ExpectedAmountSource =
  | "historical_median"
  | "fixed_definition"
  | "manual_override"
  | "system_fallback";
export type IncomeOccurrenceStatus =
  | "expected"
  | "partially_received"
  | "received"
  | "above_expected"
  | "below_expected"
  | "overdue"
  | "paused"
  | "closed";

export type IncomeDefinition = {
  id: string;
  title: string;
  direction: "income";
  estimationMethod: IncomeEstimationMethod;
  aggregationMode: IncomeAggregationMode;
  expectedDateRule: ExpectedDateRule;
  fixedAmountCents: number | null;
  historicalMedianCents: number | null;
  historicalAverageCents: number | null;
  conservativePlanningCents: number | null;
  contextType: "personal" | "household" | "work" | "travel";
  status: "active" | "paused" | "completed" | "cancelled" | "archived";
};

export type IncomeOccurrence = {
  id: string;
  incomeDefinitionId: string;
  competenceMonth: string;
  expectedAmountCents: number | null;
  expectedAmountSource: ExpectedAmountSource;
  receivedAmountCents: number;
  creditsCount: number;
  status: IncomeOccurrenceStatus;
  manualOverrideCents: number | null;
};

export type IncomeMonthlyTotal = {
  month: string;
  totalCents: number;
  creditsCount: number;
  hasCoverage: boolean;
  isComplete: boolean;
};

export type IncomeHistoricalStatistics = {
  monthlyTotals: IncomeMonthlyTotal[];
  medianAmount: number | null;
  averageAmount: number | null;
  monthsAvailable: number;
  monthsWithIncome: number;
  monthsWithZero: number;
  coverageMonths: number;
  confidence: "low" | "medium" | "high";
  firstMonth: string | null;
  lastMonth: string | null;
  totalCredits: number;
  warning: string | null;
};

export type IncomeExpectedAmountResolution = {
  amount: number | null;
  source: ExpectedAmountSource | null;
  historicalMedian: number | null;
  historicalAverage: number | null;
  monthsConsidered: number;
  confidence: IncomeHistoricalStatistics["confidence"];
};

export type IncomeReferenceCandidate = {
  id: string;
  description: string;
  amountCents: number;
  date: string;
  accountName: string;
};

export type IncomeExpenseOverview = {
  expectedIncomeCents: number;
  receivedIncomeCents: number;
  expectedExpenseCents: number;
  paidExpenseCents: number;
  projectedBalanceCents: number;
  realizedBalanceCents: number;
};

const monthStart = (value: string) => `${value.slice(0, 7)}-01`;

export function aggregateIncomeCreditsByMonth(
  credits: Array<{ date: string; amountCents: number }>,
): IncomeMonthlyTotal[] {
  const grouped = new Map<string, { totalCents: number; creditsCount: number }>();
  for (const credit of credits) {
    if (!Number.isFinite(credit.amountCents) || credit.amountCents <= 0) continue;
    const month = monthStart(credit.date);
    const current = grouped.get(month) ?? { totalCents: 0, creditsCount: 0 };
    current.totalCents += Math.round(credit.amountCents);
    current.creditsCount += 1;
    grouped.set(month, current);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => ({
      month,
      ...value,
      hasCoverage: true,
      isComplete: true,
    }));
}

export function median(values: number[]) {
  const sorted = values
    .filter(Number.isFinite)
    .map(Math.round)
    .sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function calculateHistoricalMonthlyIncomeMedian(input: {
  monthlyTotals: IncomeMonthlyTotal[];
  maximumMonths?: number;
  includeZeroMonths?: boolean;
  activeFrom?: string | null;
  endMonth: string;
}): IncomeHistoricalStatistics {
  const maximumMonths = Math.min(12, Math.max(1, input.maximumMonths ?? 12));
  const endMonth = monthStart(input.endMonth);
  const activeFrom = input.activeFrom ? monthStart(input.activeFrom) : null;
  const usable = input.monthlyTotals
    .filter(item =>
      item.month < endMonth &&
      item.isComplete &&
      item.hasCoverage &&
      (!activeFrom || item.month >= activeFrom) &&
      (input.includeZeroMonths !== false || item.totalCents > 0)
    )
    .sort((left, right) => right.month.localeCompare(left.month))
    .slice(0, maximumMonths)
    .reverse();
  const totals = usable.map(item => item.totalCents);
  const medianAmount = median(totals);
  const averageAmount = totals.length
    ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length)
    : null;
  const monthsWithIncome = usable.filter(item => item.totalCents > 0).length;
  const confidence = usable.length >= 9
    ? "high"
    : usable.length >= 3
      ? "medium"
      : "low";
  return {
    monthlyTotals: usable,
    medianAmount,
    averageAmount,
    monthsAvailable: usable.length,
    monthsWithIncome,
    monthsWithZero: usable.length - monthsWithIncome,
    coverageMonths: usable.length,
    confidence,
    firstMonth: usable[0]?.month ?? null,
    lastMonth: usable.at(-1)?.month ?? null,
    totalCredits: usable.reduce((sum, item) => sum + item.creditsCount, 0),
    warning: usable.length < 3
      ? "Há pouco histórico disponível. A estimativa pode mudar conforme novos recebimentos forem registrados."
      : null,
  };
}

export function resolveIncomeExpectedAmount(input: {
  manualOverrideCents?: number | null;
  fixedAmountCents?: number | null;
  statistics?: IncomeHistoricalStatistics | null;
  lastKnownAmountCents?: number | null;
}): IncomeExpectedAmountResolution {
  const statistics = input.statistics ?? null;
  const base = {
    historicalMedian: statistics?.medianAmount ?? null,
    historicalAverage: statistics?.averageAmount ?? null,
    monthsConsidered: statistics?.monthsAvailable ?? 0,
    confidence: statistics?.confidence ?? "low" as const,
  };
  if (input.manualOverrideCents !== null &&
    input.manualOverrideCents !== undefined) {
    return {
      ...base,
      amount: input.manualOverrideCents,
      source: "manual_override",
    };
  }
  if (input.fixedAmountCents !== null &&
    input.fixedAmountCents !== undefined) {
    return {
      ...base,
      amount: input.fixedAmountCents,
      source: "fixed_definition",
    };
  }
  if (statistics?.medianAmount !== null &&
    statistics?.medianAmount !== undefined) {
    return {
      ...base,
      amount: statistics.medianAmount,
      source: "historical_median",
    };
  }
  if (input.lastKnownAmountCents !== null &&
    input.lastKnownAmountCents !== undefined) {
    return {
      ...base,
      amount: input.lastKnownAmountCents,
      source: "system_fallback",
    };
  }
  return { ...base, amount: null, source: null };
}

export function resolveMonthlyIncomeOccurrenceStatus(input: {
  expectedAmountCents: number | null;
  receivedAmountCents: number;
  monthComplete: boolean;
  expectedDatePassed?: boolean;
  toleranceCents?: number;
  paused?: boolean;
}) {
  if (input.paused) return "paused" as const;
  const received = Math.max(0, input.receivedAmountCents);
  const expected = Math.max(0, input.expectedAmountCents ?? 0);
  const tolerance = Math.max(
    input.toleranceCents ?? Math.round(expected * 0.02),
    1,
  );
  if (input.monthComplete) {
    if (!received && input.expectedDatePassed) return "overdue" as const;
    if (received > expected + tolerance) return "above_expected" as const;
    if (received + tolerance < expected) return "below_expected" as const;
    return received ? "received" as const : "expected" as const;
  }
  if (!received) {
    return input.expectedDatePassed ? "overdue" as const : "expected" as const;
  }
  if (received > expected + tolerance) return "above_expected" as const;
  if (expected && received + tolerance < expected) {
    return "partially_received" as const;
  }
  return "received" as const;
}

function daysInMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function isBusinessDay(value: Date, holidays: Set<string>) {
  const day = value.getUTCDay();
  return day !== 0 && day !== 6 &&
    !holidays.has(value.toISOString().slice(0, 10));
}

export function resolveExpectedBusinessDate(input: {
  month: string;
  rule: ExpectedDateRule;
  fixedDay?: number | null;
  holidays?: string[];
}) {
  if (input.rule === "unspecified_in_month") return null;
  const year = Number(input.month.slice(0, 4));
  const monthIndex = Number(input.month.slice(5, 7)) - 1;
  const holidays = new Set(input.holidays ?? []);
  if (input.rule === "fixed_day") {
    const day = Math.min(
      Math.max(input.fixedDay ?? 1, 1),
      daysInMonth(year, monthIndex),
    );
    return new Date(Date.UTC(year, monthIndex, day))
      .toISOString().slice(0, 10);
  }
  const dates = Array.from(
    { length: daysInMonth(year, monthIndex) },
    (_, index) => new Date(Date.UTC(year, monthIndex, index + 1)),
  ).filter(value => isBusinessDay(value, holidays));
  const date = input.rule === "first_business_day"
    ? dates[0]
    : input.rule === "fifth_business_day"
      ? dates[4]
      : dates.at(-1);
  return date?.toISOString().slice(0, 10) ?? null;
}

export function calculateIncomeExpenseOverview(input: {
  incomes: Array<{ expectedCents: number; receivedCents: number }>;
  expenses: Array<{ expectedCents: number; paidCents: number }>;
}): IncomeExpenseOverview {
  const expectedIncomeCents = input.incomes.reduce(
    (sum, item) => sum + item.expectedCents,
    0,
  );
  const receivedIncomeCents = input.incomes.reduce(
    (sum, item) => sum + item.receivedCents,
    0,
  );
  const expectedExpenseCents = input.expenses.reduce(
    (sum, item) => sum + item.expectedCents,
    0,
  );
  const paidExpenseCents = input.expenses.reduce(
    (sum, item) => sum + item.paidCents,
    0,
  );
  return {
    expectedIncomeCents,
    receivedIncomeCents,
    expectedExpenseCents,
    paidExpenseCents,
    projectedBalanceCents: expectedIncomeCents - expectedExpenseCents,
    realizedBalanceCents: receivedIncomeCents - paidExpenseCents,
  };
}
