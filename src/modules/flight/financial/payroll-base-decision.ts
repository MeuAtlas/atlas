export type PayrollBaseScenario = "PLANNED" | "EXECUTED" | "TIE" | "UNAVAILABLE";

export type PayrollBaseDecisionInput = {
  plannedGrossCents: number | null;
  executedGrossCents: number | null;
};

export type PayrollBaseDecision = PayrollBaseDecisionInput & {
  selectedScenario: PayrollBaseScenario;
  grossDifferenceCents: number | null;
  reason: "HIGHER_GROSS_PAY" | "EQUAL_GROSS_PAY" | "SCENARIO_UNAVAILABLE";
};

/**
 * Chooses one complete schedule scenario. Monetary values are always integer
 * cents; flight time, duty time and net pay deliberately have no role here.
 */
export function decidePayrollBase(input: PayrollBaseDecisionInput): PayrollBaseDecision {
  const { plannedGrossCents, executedGrossCents } = input;
  if (plannedGrossCents === null || executedGrossCents === null) {
    return { ...input, selectedScenario: "UNAVAILABLE", grossDifferenceCents: null, reason: "SCENARIO_UNAVAILABLE" };
  }
  const grossDifferenceCents = executedGrossCents - plannedGrossCents;
  if (grossDifferenceCents === 0) {
    return { ...input, selectedScenario: "TIE", grossDifferenceCents, reason: "EQUAL_GROSS_PAY" };
  }
  return {
    ...input,
    selectedScenario: grossDifferenceCents > 0 ? "EXECUTED" : "PLANNED",
    grossDifferenceCents,
    reason: "HIGHER_GROSS_PAY",
  };
}
