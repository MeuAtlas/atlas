export type OffPeriodForMatching = { id: string; startDate: string; endDate: string; startAt: string | null; endAt: string | null; sourceEventIds: string[] };
export type OffPeriodMatch = { plannedOffPeriodId: string | null; executedOffPeriodId: string; matchingStatus: "MATCHED" | "AMBIGUOUS" | "UNMATCHED"; matchingConfidence: "HIGH" | "MEDIUM" | "LOW"; plannedStartAt: string | null; executedStartAt: string | null; deltaStartMinutes: number | null; plannedEndAt: string | null; executedEndAt: string | null; deltaEndMinutes: number | null; plannedSourceEventIds: string[]; executedSourceEventIds: string[] };

function overlaps(left: OffPeriodForMatching, right: OffPeriodForMatching) { return left.startDate <= right.endDate && left.endDate >= right.startDate; }
function delta(executed: string | null, planned: string | null) { return executed && planned ? Math.round((Date.parse(executed) - Date.parse(planned)) / 60000) : null; }

export function matchOffPeriods(planned: OffPeriodForMatching[], executed: OffPeriodForMatching[]): OffPeriodMatch[] {
  return executed.map((current) => {
    const candidates = planned.filter((candidate) => overlaps(candidate, current));
    if (candidates.length !== 1) return { plannedOffPeriodId: null, executedOffPeriodId: current.id, matchingStatus: candidates.length ? "AMBIGUOUS" : "UNMATCHED", matchingConfidence: "LOW", plannedStartAt: null, executedStartAt: current.startAt, deltaStartMinutes: null, plannedEndAt: null, executedEndAt: current.endAt, deltaEndMinutes: null, plannedSourceEventIds: [], executedSourceEventIds: current.sourceEventIds };
    const candidate = candidates[0];
    return { plannedOffPeriodId: candidate.id, executedOffPeriodId: current.id, matchingStatus: "MATCHED", matchingConfidence: candidate.startDate === current.startDate && candidate.endDate === current.endDate ? "HIGH" : "MEDIUM", plannedStartAt: candidate.startAt, executedStartAt: current.startAt, deltaStartMinutes: delta(current.startAt, candidate.startAt), plannedEndAt: candidate.endAt, executedEndAt: current.endAt, deltaEndMinutes: delta(current.endAt, candidate.endAt), plannedSourceEventIds: candidate.sourceEventIds, executedSourceEventIds: current.sourceEventIds };
  });
}
