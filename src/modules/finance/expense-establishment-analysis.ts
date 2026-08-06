export type EstablishmentTransaction = {
  id: string;
  establishmentId: string;
  date: string;
  amountCents: number;
  description: string;
  sourceLabel: string;
  bankDirection: string | null;
  transactionRole: string | null;
  transactionType: string | null;
  status: string | null;
};

export type EstablishmentDefinition = {
  id: string;
  name: string;
  categoryName: string | null;
  aliases: string[];
};

export type EstablishmentMonth = {
  month: string;
  totalCents: number;
  count: number;
};

export type EstablishmentAnalysis = EstablishmentDefinition & {
  transactions: EstablishmentTransaction[];
  monthlyHistory: EstablishmentMonth[];
  monthTotalCents: number;
  monthCount: number;
  medianMonthlyCents: number | null;
  medianFrequency: number | null;
  comparison: "above" | "below" | "within" | "insufficient" | "none";
  comparisonPercent: number | null;
  firstDate: string | null;
  lastDate: string | null;
  historyMonths: number;
};

export const ESTABLISHMENT_HABITUAL_VARIATION = 0.15;

const dateMonth = (date: string) => date.slice(0, 7);
export function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}

export function isValidEstablishmentTransaction(transaction: EstablishmentTransaction) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(transaction.date)) return false;
  if (["cancelled", "disputed", "archived"].includes(transaction.status ?? "")) return false;
  if (["invoice_payment", "transfer"].includes(transaction.transactionRole ?? "")) return false;
  if (transaction.transactionType === "income") return false;
  return transaction.bankDirection === "outflow" ||
    ["refund", "reversal"].includes(transaction.transactionRole ?? "");
}

function signedAmount(transaction: EstablishmentTransaction) {
  if (["refund", "reversal"].includes(transaction.transactionRole ?? "") ||
    transaction.bankDirection === "inflow") return -Math.abs(transaction.amountCents);
  return Math.abs(transaction.amountCents);
}

function historyForComparison(history: EstablishmentMonth[], selectedMonth: string, currentMonth: string) {
  return history.filter(item => item.month !== selectedMonth && item.month < currentMonth);
}

export function buildEstablishmentAnalyses({
  establishments,
  transactions,
  selectedMonth,
  currentMonth,
}: {
  establishments: EstablishmentDefinition[];
  transactions: EstablishmentTransaction[];
  selectedMonth: string;
  currentMonth: string;
}): EstablishmentAnalysis[] {
  const byEstablishment = new Map<string, EstablishmentTransaction[]>();
  for (const transaction of transactions.filter(isValidEstablishmentTransaction)) {
    const rows = byEstablishment.get(transaction.establishmentId) ?? [];
    rows.push(transaction);
    byEstablishment.set(transaction.establishmentId, rows);
  }

  return establishments.map(establishment => {
    const linked = (byEstablishment.get(establishment.id) ?? [])
      .sort((left, right) => right.date.localeCompare(left.date));
    const monthly = new Map<string, EstablishmentMonth>();
    for (const transaction of linked) {
      const month = dateMonth(transaction.date);
      const item = monthly.get(month) ?? { month, totalCents: 0, count: 0 };
      item.totalCents += signedAmount(transaction);
      item.count += 1;
      monthly.set(month, item);
    }
    const monthlyHistory = [...monthly.values()].sort((left, right) =>
      right.month.localeCompare(left.month));
    const selected = monthly.get(selectedMonth) ?? {
      month: selectedMonth, totalCents: 0, count: 0,
    };
    const reference = historyForComparison(monthlyHistory, selectedMonth, currentMonth);
    const medianMonthlyCents = reference.length >= 3
      ? median(reference.map(item => item.totalCents))
      : null;
    const medianFrequency = reference.length >= 3
      ? median(reference.map(item => item.count))
      : null;
    const comparisonPercent = medianMonthlyCents && selected.totalCents
      ? (selected.totalCents - medianMonthlyCents) / medianMonthlyCents
      : null;
    const comparison = selected.totalCents === 0
      ? "none"
      : medianMonthlyCents === null || comparisonPercent === null
        ? "insufficient"
        : Math.abs(comparisonPercent) <= ESTABLISHMENT_HABITUAL_VARIATION
          ? "within"
          : comparisonPercent > 0 ? "above" : "below";

    return {
      ...establishment,
      transactions: linked,
      monthlyHistory,
      monthTotalCents: selected.totalCents,
      monthCount: selected.count,
      medianMonthlyCents,
      medianFrequency,
      comparison,
      comparisonPercent,
      firstDate: linked.at(-1)?.date ?? null,
      lastDate: linked[0]?.date ?? null,
      historyMonths: reference.length,
    };
  });
}

export function sortEstablishmentAnalyses(
  rows: EstablishmentAnalysis[],
  order: "highest" | "lowest" | "count" | "above_median" | "name",
) {
  return [...rows].sort((left, right) => {
    if (order === "name") return left.name.localeCompare(right.name, "pt-BR");
    if (order === "lowest") return left.monthTotalCents - right.monthTotalCents ||
      left.name.localeCompare(right.name, "pt-BR");
    if (order === "count") return right.monthCount - left.monthCount ||
      right.monthTotalCents - left.monthTotalCents ||
      left.name.localeCompare(right.name, "pt-BR");
    if (order === "above_median") return (right.comparisonPercent ?? -Infinity) -
      (left.comparisonPercent ?? -Infinity) || right.monthTotalCents - left.monthTotalCents ||
      left.name.localeCompare(right.name, "pt-BR");
    const leftHasMovement = left.monthTotalCents !== 0 ? 0 : 1;
    const rightHasMovement = right.monthTotalCents !== 0 ? 0 : 1;
    return leftHasMovement - rightHasMovement || right.monthTotalCents - left.monthTotalCents ||
      left.name.localeCompare(right.name, "pt-BR");
  });
}

export function establishmentInsight(item: EstablishmentAnalysis) {
  if (item.medianMonthlyCents === null || item.medianFrequency === null) {
    return "Não há histórico suficiente para comparação.";
  }
  const selected = item.monthlyHistory.find(month => month.totalCents === item.monthTotalCents &&
    month.count === item.monthCount);
  const frequencyDifference = item.monthCount - item.medianFrequency;
  if (item.comparison === "above" && Math.abs(frequencyDifference) <= .5) {
    return "O valor ficou acima do habitual, com frequência semelhante ao histórico.";
  }
  if (item.comparison === "above" && frequencyDifference > .5) {
    return "O aumento do total foi acompanhado por mais pagamentos no período.";
  }
  if (item.comparison === "below" && frequencyDifference > .5) {
    return "A frequência aumentou, mas o valor médio por pagamento diminuiu.";
  }
  void selected;
  return "O comportamento ficou dentro do habitual.";
}
