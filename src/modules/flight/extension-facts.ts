export type ExtensionFactInput = {
  plannedDutyId: string | null;
  executedDutyId: string | null;
  plannedDutyMinutes: number | null;
  executedDutyMinutes: number | null;
  plannedFlightTimeMinutes: number | null;
  executedFlightTimeMinutes: number | null;
  plannedOperatingLegCount: number | null;
  executedOperatingLegCount: number | null;
  normalDutyLimitMinutes: number | null;
  normalFlightTimeLimitMinutes: number | null;
  matched: boolean;
  unexpectedOperationalCircumstance?: unknown;
  commanderExtensionDecision?: unknown;
};

const asKnownBoolean = (value: unknown): "TRUE" | "FALSE" | "UNKNOWN" =>
  value === true || value === "TRUE" ? "TRUE" : value === false || value === "FALSE" ? "FALSE" : "UNKNOWN";

export function deriveExtensionFacts(input: ExtensionFactInput) {
  const limitsKnown = input.matched
    && input.normalDutyLimitMinutes !== null
    && input.normalFlightTimeLimitMinutes !== null
    && input.executedDutyMinutes !== null
    && input.executedFlightTimeMinutes !== null;
  const dutyExtension = limitsKnown
    ? Math.max(input.executedDutyMinutes! - input.normalDutyLimitMinutes!, 0)
    : "UNKNOWN";
  const flightExtension = limitsKnown
    ? Math.max(input.executedFlightTimeMinutes! - input.normalFlightTimeLimitMinutes!, 0)
    : "UNKNOWN";
  const additionalOperatingLegs = input.matched
    && input.plannedOperatingLegCount !== null
    && input.executedOperatingLegCount !== null
    ? Math.max(input.executedOperatingLegCount - input.plannedOperatingLegCount, 0)
    : "UNKNOWN";

  return {
    plannedDutyId: input.plannedDutyId,
    executedDutyId: input.executedDutyId,
    extensionRequired: limitsKnown && (dutyExtension !== 0 || flightExtension !== 0) ? "TRUE" : limitsKnown ? "FALSE" : "UNKNOWN",
    dutyExtensionMinutes: dutyExtension,
    flightTimeExtensionMinutes: flightExtension,
    additionalOperatingLegs,
    plannedDutyMinutes: input.plannedDutyMinutes,
    executedDutyMinutes: input.executedDutyMinutes,
    plannedFlightTimeMinutes: input.plannedFlightTimeMinutes,
    executedFlightTimeMinutes: input.executedFlightTimeMinutes,
    plannedOperatingLegCount: input.plannedOperatingLegCount,
    executedOperatingLegCount: input.executedOperatingLegCount,
    unexpectedOperationalCircumstance: asKnownBoolean(input.unexpectedOperationalCircumstance),
    commanderExtensionDecision: asKnownBoolean(input.commanderExtensionDecision),
  };
}
