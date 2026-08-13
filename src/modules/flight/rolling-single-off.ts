export type RollingSingleOffPeriod = { id: string; startDate: string; endDate: string; isSingleOff: boolean };
export type RollingSingleOffResult = { subjectId: string; value: number | "UNKNOWN"; windowStart: string; windowEnd: string; includedOffPeriodIds: string[]; historyComplete: boolean; confidence: "HIGH" | "LOW" };

function shiftDays(date: string, days: number) { const instant = new Date(`${date}T12:00:00Z`); instant.setUTCDate(instant.getUTCDate() + days); return instant.toISOString().slice(0, 10); }

export function buildRollingSingleOff30d(periods: RollingSingleOffPeriod[], documentStart: string, documentEnd: string): RollingSingleOffResult[] {
  return periods.filter((period) => period.isSingleOff).map((subject) => { const windowEnd = subject.startDate; const windowStart = shiftDays(windowEnd, -29); const historyComplete = documentStart <= windowStart && subject.endDate <= documentEnd; const included = historyComplete ? periods.filter((period) => period.isSingleOff && period.startDate >= windowStart && period.startDate <= windowEnd).map((period) => period.id) : []; return { subjectId: subject.id, value: historyComplete ? included.length : "UNKNOWN", windowStart, windowEnd, includedOffPeriodIds: included, historyComplete, confidence: historyComplete ? "HIGH" : "LOW" }; });
}
