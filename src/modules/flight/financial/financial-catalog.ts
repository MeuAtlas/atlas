export const FLIGHT_FINANCIAL_CATALOG_VERSION = "flight-financial-catalog/1.0.0";

export type CompensationRole = "COPILOT" | "COMMANDER";
export type FinancialLifecycle = "DRAFT" | "REVIEWED" | "ACTIVE" | "RETIRED" | "REVIEW_REQUIRED";
export type FinancialSourceType = "DOCUMENT_SOURCE" | "USER_CONFIRMED_PROFILE_FACT" | "SYSTEM_DERIVED";

export type CompensationProfile = {
  id: string;
  userId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  role: CompensationRole;
  roleEffectiveFrom: string | null;
  seniorityPercentage: string;
  internalCommanderPromotionBonusPercentage: string | null;
  contractualBase: string | null;
  employmentRegime: string | null;
  sourceType: FinancialSourceType;
  sourceReference: string | null;
};

export type EconomicParameterSeed = {
  parameterKey: string;
  role: CompensationRole | null;
  valueCents: number | null;
  valueNumeric: string | null;
  valueUnit: string;
  currency: "BRL";
  effectiveFrom: string | null;
  lifecycle: FinancialLifecycle;
  sourceType: FinancialSourceType;
  derived: boolean;
  seniorityApplicable: boolean;
  metadata?: Record<string, unknown>;
};

export function resolveCompensationProfile<T extends CompensationProfile>(profiles: readonly T[], date: string): T | null {
  const eligible = profiles.filter((profile) => profile.effectiveFrom <= date && (profile.effectiveTo === null || profile.effectiveTo >= date));
  return eligible.length === 1 ? eligible[0] : null;
}

export function totalFlightHourCents(baseCents: number, dsrCents: number, hazardCents: number): number {
  return baseCents + dsrCents + hazardCents;
}

export const FLIGHT_ECONOMIC_PARAMETER_SEEDS: readonly EconomicParameterSeed[] = [
  { parameterKey: "FLIGHT_HOUR_BASE", role: "COMMANDER", valueCents: 19451, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_DSR", role: "COMMANDER", valueCents: 7073, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_HAZARD", role: "COMMANDER", valueCents: 7957, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_TOTAL", role: "COMMANDER", valueCents: 28181, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "SYSTEM_DERIVED", derived: true, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_BASE", role: "COPILOT", valueCents: 8947, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_DSR", role: "COPILOT", valueCents: 3253, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_HAZARD", role: "COPILOT", valueCents: 3660, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "FLIGHT_HOUR_TOTAL", role: "COPILOT", valueCents: 15860, valueNumeric: null, valueUnit: "CENT_PER_FLIGHT_HOUR", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "SYSTEM_DERIVED", derived: true, seniorityApplicable: false },
  { parameterKey: "SALARY_FLOOR", role: "COMMANDER", valueCents: null, valueNumeric: null, valueUnit: "CENT_PER_MONTH", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: true, metadata: { requiresSourceValue: true } },
  { parameterKey: "SALARY_FLOOR", role: "COPILOT", valueCents: null, valueNumeric: null, valueUnit: "CENT_PER_MONTH", currency: "BRL", effectiveFrom: null, lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: true, metadata: { requiresSourceValue: true } },
  { parameterKey: "MONTHLY_FLIGHT_HOUR_GUARANTEE", role: null, valueCents: null, valueNumeric: "3240", valueUnit: "MINUTES", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "STANDBY_EQUIVALENCE", role: null, valueCents: null, valueNumeric: "1", valueUnit: "RATIO", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { numerator: 1, denominator: 3 } },
  { parameterKey: "RESERVE_HOUR_RELATION", role: null, valueCents: null, valueNumeric: null, valueUnit: "REFERENCE", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { relation: "SAME_AS_NORMAL_FLIGHT_HOUR", referencedParameterKey: "FLIGHT_HOUR_TOTAL" } },
  { parameterKey: "SUNDAY_HOLIDAY_MULTIPLIER", role: null, valueCents: null, valueNumeric: "2", valueUnit: "MULTIPLIER", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "NIGHT_WINDOW", role: null, valueCents: null, valueNumeric: null, valueUnit: "UTC_TIME_WINDOW", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { start: "21:00", end: "09:00", timezone: "UTC" } },
  { parameterKey: "NIGHT_HOUR_DURATION", role: null, valueCents: null, valueNumeric: "3150", valueUnit: "SECONDS", currency: "BRL", effectiveFrom: "2025-10-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "ECONOMIC_ADJUSTMENT", role: null, valueCents: null, valueNumeric: "4.68", valueUnit: "PERCENT", currency: "BRL", effectiveFrom: "2025-12-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { eligibleParameterFamilies: ["SALARY_FLOOR", "MEAL_MAIN_DIEM"], automaticallyApplied: false } },
  { parameterKey: "FUTURE_ECONOMIC_ADJUSTMENT", role: null, valueCents: null, valueNumeric: "10", valueUnit: "PERCENT", currency: "BRL", effectiveFrom: "2027-04-01", lifecycle: "REVIEW_REQUIRED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { adjustmentOnly: true, automaticallyApplied: false } },
  { parameterKey: "MEAL_MAIN_DIEM", role: null, valueCents: 10995, valueNumeric: null, valueUnit: "CENT_PER_DIEM", currency: "BRL", effectiveFrom: "2025-12-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false },
  { parameterKey: "BREAKFAST_DIEM_PERCENT", role: null, valueCents: null, valueNumeric: "25", valueUnit: "PERCENT", currency: "BRL", effectiveFrom: "2025-12-01", lifecycle: "REVIEWED", sourceType: "DOCUMENT_SOURCE", derived: false, seniorityApplicable: false, metadata: { baseParameterKey: "MEAL_MAIN_DIEM" } },
];
