export const FLIGHT_TIME_RECONCILIATION_THRESHOLD_MINUTES = 5;

export type FlightTimeReconciliation = {
  status: "VALID" | "INCOMPLETE" | "UNKNOWN";
  documentedMinutes: number | null;
  processedMinutes: number | null;
  differenceMinutes: number | null;
  missingMinutes: number | null;
  thresholdMinutes: number;
};

export function reconcileFlightTime(
  documentedMinutes: number | null,
  processedMinutes: number | null,
  thresholdMinutes = FLIGHT_TIME_RECONCILIATION_THRESHOLD_MINUTES,
): FlightTimeReconciliation {
  if (documentedMinutes === null || processedMinutes === null) {
    return { status: "UNKNOWN", documentedMinutes, processedMinutes, differenceMinutes: null, missingMinutes: null, thresholdMinutes };
  }
  const differenceMinutes = processedMinutes - documentedMinutes;
  return {
    status: Math.abs(differenceMinutes) <= thresholdMinutes ? "VALID" : "INCOMPLETE",
    documentedMinutes,
    processedMinutes,
    differenceMinutes,
    missingMinutes: Math.max(0, documentedMinutes - processedMinutes),
    thresholdMinutes,
  };
}
