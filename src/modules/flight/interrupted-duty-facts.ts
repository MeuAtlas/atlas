export type InterruptedDutyGap = {
  startAt: string | null;
  endAt: string | null;
  airport: string | null;
  timezone: string | null;
};

export type InterruptedDutyInput = {
  dutyId: string;
  dutyEndAt: string | null;
  gaps: InterruptedDutyGap[];
  contractualBase: string | null;
  accommodationType?: unknown;
  accommodationConfirmed?: unknown;
  restAccommodationConfirmed?: unknown;
};

const MINIMUM_STRUCTURAL_CANDIDATE_MINUTES = 120;
const unknownBoolean = (value: unknown): "TRUE" | "FALSE" | "UNKNOWN" => value === true || value === "TRUE" ? "TRUE" : value === false || value === "FALSE" ? "FALSE" : "UNKNOWN";

function localDateTime(instant: string, timezone: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
}

function touchesEarlyLocalWindow(startAt: string, endAt: string, timezone: string): "TRUE" | "FALSE" {
  for (let instant = Date.parse(startAt); instant < Date.parse(endAt); instant += 60_000) {
    const hour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date(instant)));
    if (hour < 6) return "TRUE";
  }
  return "FALSE";
}

export function deriveInterruptedDutyFact(input: InterruptedDutyInput) {
  const gaps = input.gaps.map((gap) => {
    if (!gap.startAt || !gap.endAt || Date.parse(gap.endAt) <= Date.parse(gap.startAt)) return null;
    return { ...gap, minutes: Math.round((Date.parse(gap.endAt) - Date.parse(gap.startAt)) / 60_000) };
  });
  const candidates = gaps.filter((gap): gap is InterruptedDutyGap & { startAt: string; endAt: string; minutes: number } => gap !== null && gap.minutes >= MINIMUM_STRUCTURAL_CANDIDATE_MINUTES);
  const intervalUnknown = gaps.some((gap) => gap === null);
  if (candidates.length !== 1) return {
    interruptedDutyDetected: candidates.length > 1 || intervalUnknown ? "UNKNOWN" : "FALSE",
    interruptionStartAt: null, interruptionEndAt: null, interruptionMinutes: null, interruptionAirport: null, interruptionTimezone: null,
    interruptionLocalStart: null, interruptionLocalEnd: null, interruptionTouches0000To0600: "UNKNOWN",
    accommodationType: "UNKNOWN", accommodationConfirmed: "UNKNOWN", restAccommodationConfirmed: "UNKNOWN",
    dutyOutsideContractualBase: "UNKNOWN", postInterruptionDutyMinutes: "UNKNOWN",
  };
  const interruption = candidates[0];
  const localKnown = interruption.timezone !== null;
  const postInterruptionDutyMinutes = input.dutyEndAt && Date.parse(input.dutyEndAt) >= Date.parse(interruption.endAt)
    ? Math.round((Date.parse(input.dutyEndAt) - Date.parse(interruption.endAt)) / 60_000)
    : "UNKNOWN";
  return {
    interruptedDutyDetected: "TRUE",
    interruptionStartAt: interruption.startAt,
    interruptionEndAt: interruption.endAt,
    interruptionMinutes: interruption.minutes,
    interruptionAirport: interruption.airport,
    interruptionTimezone: interruption.timezone,
    interruptionLocalStart: localKnown ? localDateTime(interruption.startAt, interruption.timezone!) : null,
    interruptionLocalEnd: localKnown ? localDateTime(interruption.endAt, interruption.timezone!) : null,
    interruptionTouches0000To0600: localKnown ? touchesEarlyLocalWindow(interruption.startAt, interruption.endAt, interruption.timezone!) : "UNKNOWN",
    accommodationType: input.accommodationType === "NONE" || input.accommodationType === "RESERVE_TYPE" || input.accommodationType === "REST_TYPE" ? input.accommodationType : "UNKNOWN",
    accommodationConfirmed: unknownBoolean(input.accommodationConfirmed),
    restAccommodationConfirmed: unknownBoolean(input.restAccommodationConfirmed),
    dutyOutsideContractualBase: input.contractualBase && interruption.airport ? interruption.airport === input.contractualBase ? "FALSE" : "TRUE" : "UNKNOWN",
    postInterruptionDutyMinutes,
  };
}

export function deriveInterruptedDutyCount168h(dutyId: string, interruptionEndAt: string | null, detected: unknown, confirmedDuties: Array<{ dutyId: string; interruptionEndAt: string }>, historyStartAt: string | null) {
  if (detected !== "TRUE" || !interruptionEndAt) return { value: "UNKNOWN", windowStart: null, windowEnd: null, includedDutyIds: [], historyComplete168h: false, confidence: "LOW" as const };
  const windowEnd = interruptionEndAt;
  const windowStart = new Date(Date.parse(windowEnd) - 168 * 60 * 60 * 1000).toISOString();
  if (!historyStartAt || Date.parse(historyStartAt) > Date.parse(windowStart)) return { value: "UNKNOWN", windowStart, windowEnd, includedDutyIds: [], historyComplete168h: false, confidence: "LOW" as const };
  const includedDutyIds = confirmedDuties.filter((duty) => Date.parse(duty.interruptionEndAt) >= Date.parse(windowStart) && Date.parse(duty.interruptionEndAt) <= Date.parse(windowEnd)).map((duty) => duty.dutyId);
  return { value: includedDutyIds.length, windowStart, windowEnd, includedDutyIds, historyComplete168h: true, confidence: "HIGH" as const };
}
