function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(value: Date, offset: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + offset, 1));
}

export function calculateExpenseEstablishmentMetrics(
  rows: Array<{ amount: number; date: string }>,
  referenceDate = new Date(),
) {
  const valid = rows.filter(row => Number.isFinite(row.amount) && /^\d{4}-\d{2}/.test(row.date));
  const referenceMonth = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    1,
  ));
  const earliest = valid.reduce<Date | null>((current, row) => {
    const candidate = new Date(`${row.date.slice(0, 7)}-01T00:00:00Z`);
    return !current || candidate < current ? candidate : current;
  }, null);
  const firstMonth = earliest && earliest > addMonths(referenceMonth, -11)
    ? earliest
    : addMonths(referenceMonth, -11);
  const months: string[] = [];
  for (let cursor = firstMonth; cursor <= referenceMonth; cursor = addMonths(cursor, 1)) {
    months.push(monthKey(cursor));
  }
  const totals = new Map(months.map(month => [month, 0]));
  for (const row of valid) {
    const key = row.date.slice(0, 7);
    if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + Math.abs(row.amount));
  }
  const monthlyValues = [...totals.values()].sort((left, right) => left - right);
  const middle = Math.floor(monthlyValues.length / 2);
  const medianMonthly = monthlyValues.length % 2
    ? monthlyValues[middle]
    : ((monthlyValues[middle - 1] ?? 0) + (monthlyValues[middle] ?? 0)) / 2;
  const last12MonthsTotal = monthlyValues.reduce((sum, value) => sum + value, 0);
  return {
    paymentCount: valid.length,
    currentMonthTotal: totals.get(monthKey(referenceMonth)) ?? 0,
    last12MonthsTotal,
    averagePayment: valid.length
      ? valid.reduce((sum, row) => sum + Math.abs(row.amount), 0) / valid.length
      : 0,
    medianMonthly,
    observedMonths: months.length,
  };
}
