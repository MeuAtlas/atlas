export type SingleOffPeriod = { id: string; startDate: string; endDate: string; isSingleOff: boolean };
export type ConsecutiveSingleOff = { id: string; isConsecutiveSingleOff: "TRUE" | "FALSE" | "UNKNOWN"; previousSingleOffPeriodId: string | null; nextSingleOffPeriodId: string | null; consecutiveGroupId: string | null; consecutivePosition: number | null; confidence: "HIGH" | "LOW" };

export function deriveConsecutiveSingleOff(periods: SingleOffPeriod[], documentStart: string, documentEnd: string): ConsecutiveSingleOff[] {
  const ordered = [...periods].sort((left, right) => left.startDate.localeCompare(right.startDate));
  return ordered.filter((period) => period.isSingleOff).map((period) => {
    const index = ordered.findIndex((item) => item.id === period.id);
    const previous = ordered[index - 1] ?? null;
    const next = ordered[index + 1] ?? null;
    if (period.startDate === documentStart || period.endDate === documentEnd) return { id: period.id, isConsecutiveSingleOff: "UNKNOWN", previousSingleOffPeriodId: previous?.isSingleOff ? previous.id : null, nextSingleOffPeriodId: next?.isSingleOff ? next.id : null, consecutiveGroupId: null, consecutivePosition: null, confidence: "LOW" };
    const partner = previous?.isSingleOff ? previous : next?.isSingleOff ? next : null;
    return { id: period.id, isConsecutiveSingleOff: partner ? "TRUE" : "FALSE", previousSingleOffPeriodId: previous?.isSingleOff ? previous.id : null, nextSingleOffPeriodId: next?.isSingleOff ? next.id : null, consecutiveGroupId: partner ? `single-off:${[period.id, partner.id].sort().join(":")}` : null, consecutivePosition: partner ? (previous?.isSingleOff ? 2 : 1) : null, confidence: "HIGH" };
  });
}
