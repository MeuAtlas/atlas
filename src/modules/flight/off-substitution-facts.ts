export type OffMatchContext = { matchingStatus: "MATCHED" | "AMBIGUOUS" | "UNMATCHED"; plannedOffPeriodId: string | null; executedOffPeriodId: string; deltaStartMinutes: number | null; deltaEndMinutes: number | null; plannedIsSingle: boolean | null; executedIsSingle: boolean; activityOccupiedPlannedOff: boolean | null; changeVoluntary?: "TRUE" | "FALSE" | "UNKNOWN"; changeOrigin?: "COMPANY" | "PORTAL_TRADE" | "OPEN_TRIP" | "DIRECT_REQUEST" | "OPERATIONAL_DISRUPTION" | "UNKNOWN" };
export type OffSubstitutionFacts = { programSubstitution: "TRUE" | "FALSE" | "UNKNOWN"; offWasAffected: "TRUE" | "FALSE" | "UNKNOWN"; offWasSurrenderedForProgram: "TRUE" | "FALSE" | "UNKNOWN"; generatedSingleOff: "TRUE" | "FALSE" | "UNKNOWN"; changeVoluntary: "TRUE" | "FALSE" | "UNKNOWN"; changeOrigin: "COMPANY" | "PORTAL_TRADE" | "OPEN_TRIP" | "DIRECT_REQUEST" | "OPERATIONAL_DISRUPTION" | "UNKNOWN" };

export function deriveOffSubstitutionFacts(context: OffMatchContext): OffSubstitutionFacts {
  const unknown = context.matchingStatus !== "MATCHED";
  const affected = unknown || (context.deltaStartMinutes === null && context.deltaEndMinutes === null) ? "UNKNOWN" : context.deltaStartMinutes !== 0 || context.deltaEndMinutes !== 0 ? "TRUE" : "FALSE";
  const surrendered = unknown || context.activityOccupiedPlannedOff === null ? "UNKNOWN" : context.activityOccupiedPlannedOff ? "TRUE" : "FALSE";
  const substitution = surrendered === "TRUE" ? "TRUE" : affected === "FALSE" ? "FALSE" : "UNKNOWN";
  const generated = unknown || context.plannedIsSingle === null ? "UNKNOWN" : !context.executedIsSingle ? "FALSE" : context.plannedIsSingle ? "FALSE" : substitution === "TRUE" ? "TRUE" : "UNKNOWN";
  return { programSubstitution: substitution, offWasAffected: affected, offWasSurrenderedForProgram: surrendered, generatedSingleOff: generated, changeVoluntary: context.changeVoluntary ?? "UNKNOWN", changeOrigin: context.changeOrigin ?? "UNKNOWN" };
}
