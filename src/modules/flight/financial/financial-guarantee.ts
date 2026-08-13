import { createHash } from "node:crypto";

export const FLIGHT_FINANCIAL_GUARANTEE_VERSION = "flight-financial-guarantee/1.0.0";
export type FinancialComponent = "NORMAL_OPERATING" | "DEADHEAD" | "STANDBY_EQUIVALENT" | "RESERVE" | "NIGHT" | "SUNDAY" | "HOLIDAY" | "MEAL_ENTITLEMENTS" | "TRANSPORT_ENTITLEMENTS";
export type GuaranteeDecision = "PLANNED" | "EXECUTED" | "ADDITIVE" | "NO_DIFFERENCE" | "UNKNOWN";
export type Truth = "TRUE" | "FALSE" | "UNKNOWN";
export type GuaranteeComponentInput = { component: FinancialComponent; plannedQuantity: number; executedQuantity: number; unit: string; guaranteeApplicable: Truth; voluntary: Truth; origin: string; voluntaryAdditive: boolean };
export type FinancialGuarantee = GuaranteeComponentInput & { id: string; decision: GuaranteeDecision; reason: string | null; confidence: "HIGH" | "MEDIUM" | "LOW"; provenance: Record<string, unknown> };

function id(plannedImportId: string, executedImportId: string, component: FinancialComponent) { const hash = createHash("sha256").update(`${FLIGHT_FINANCIAL_GUARANTEE_VERSION}:${plannedImportId}:${executedImportId}:${component}`).digest("hex"); return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`; }

export function decideFinancialGuarantee(input: GuaranteeComponentInput): Omit<FinancialGuarantee, "id"> {
  if (input.plannedQuantity === input.executedQuantity) return { ...input, decision: "NO_DIFFERENCE", reason: null, confidence: "HIGH", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
  if (input.executedQuantity > input.plannedQuantity) return { ...input, decision: input.voluntaryAdditive ? "ADDITIVE" : "EXECUTED", reason: input.voluntaryAdditive ? "VOLUNTARY_OFF_SURRENDER_ADDITIVE" : "EXECUTED_QUANTITY_GREATER", confidence: input.voluntaryAdditive ? "HIGH" : "MEDIUM", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
  if (input.guaranteeApplicable !== "TRUE") return { ...input, decision: "UNKNOWN", reason: input.guaranteeApplicable === "FALSE" ? "GUARANTEE_NOT_APPLICABLE_TO_COMPONENT" : "GUARANTEE_SCOPE_NOT_DOCUMENTED", confidence: "LOW", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
  if (input.voluntary === "TRUE") return { ...input, decision: "EXECUTED", reason: "VOLUNTARY_CHANGE_EXECUTED_POLICY", confidence: "HIGH", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
  if (input.voluntary === "FALSE") return { ...input, decision: "PLANNED", reason: "PLANNED_REMUNERATION_GUARANTEE", confidence: "HIGH", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
  return { ...input, decision: "UNKNOWN", reason: "VOLUNTARY_STATUS_UNKNOWN", confidence: "LOW", provenance: { algorithm: "decideFinancialGuarantee", version: FLIGHT_FINANCIAL_GUARANTEE_VERSION, guaranteeApplicable: input.guaranteeApplicable } };
}

export function buildFinancialGuarantees(plannedImportId: string, executedImportId: string, inputs: GuaranteeComponentInput[]) { return inputs.map(input => ({ id: id(plannedImportId, executedImportId, input.component), ...decideFinancialGuarantee(input), provenance: { ...decideFinancialGuarantee(input).provenance, plannedImportId, executedImportId, unit: input.unit, changeOrigin: input.origin, voluntary: input.voluntary } })); }
