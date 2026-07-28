export type BankCashFlowEffect = "inflow" | "outflow" | "neutral";

export type BankCashFlowEntry = {
  id: string;
  date: string;
  amount: number;
  effect: BankCashFlowEffect;
  included?: boolean;
};

export type BankAccountCashFlowDailyPoint = {
  date: string;
  inflow: number;
  outflow: number;
  netMovement: number;
  cumulativeInflow: number;
  cumulativeOutflow: number;
};

export type BankAccountCashFlowSummary = {
  totalInflows: number;
  totalOutflows: number;
  netMovement: number;
  inflowCount: number;
  outflowCount: number;
  largestInflow: number;
  largestOutflow: number;
  dailySeries: BankAccountCashFlowDailyPoint[];
};

const toCents = (value: number) =>
  Math.round(Math.abs(Number.isFinite(value) ? value : 0) * 100);
const fromCents = (value: number) => value / 100;

export function calculateBankAccountCashFlow(
  entries: BankCashFlowEntry[],
): BankAccountCashFlowSummary {
  let inflowCents = 0;
  let outflowCents = 0;
  let inflowCount = 0;
  let outflowCount = 0;
  let largestInflowCents = 0;
  let largestOutflowCents = 0;
  const daily = new Map<
    string,
    { inflowCents: number; outflowCents: number }
  >();

  for (const entry of entries) {
    if (entry.included === false || entry.effect === "neutral") continue;
    const amountCents = toCents(entry.amount);
    const point = daily.get(entry.date) ?? {
      inflowCents: 0,
      outflowCents: 0,
    };
    if (entry.effect === "inflow") {
      inflowCents += amountCents;
      inflowCount += 1;
      largestInflowCents = Math.max(largestInflowCents, amountCents);
      point.inflowCents += amountCents;
    } else {
      outflowCents += amountCents;
      outflowCount += 1;
      largestOutflowCents = Math.max(largestOutflowCents, amountCents);
      point.outflowCents += amountCents;
    }
    daily.set(entry.date, point);
  }

  let cumulativeInflowCents = 0;
  let cumulativeOutflowCents = 0;
  const dailySeries = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, point]) => {
      cumulativeInflowCents += point.inflowCents;
      cumulativeOutflowCents += point.outflowCents;
      return {
        date,
        inflow: fromCents(point.inflowCents),
        outflow: fromCents(point.outflowCents),
        netMovement: fromCents(point.inflowCents - point.outflowCents),
        cumulativeInflow: fromCents(cumulativeInflowCents),
        cumulativeOutflow: fromCents(cumulativeOutflowCents),
      };
    });

  return {
    totalInflows: fromCents(inflowCents),
    totalOutflows: fromCents(outflowCents),
    netMovement: fromCents(inflowCents - outflowCents),
    inflowCount,
    outflowCount,
    largestInflow: fromCents(largestInflowCents),
    largestOutflow: fromCents(largestOutflowCents),
    dailySeries,
  };
}
