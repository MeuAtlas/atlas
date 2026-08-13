import { createHash } from "node:crypto";

export const FLIGHT_FINANCIAL_UNITS_VERSION = "flight-financial-units/1.0.0";
export type FinancialUnitType = "OPERATING_REMUNERABLE_MINUTES" | "DEADHEAD_REMUNERABLE_MINUTES" | "STANDBY_GUARANTEE_EQUIVALENT" | "RESERVE_REMUNERABLE_MINUTES" | "PRELIMINARY_GUARANTEE_ACCUMULATOR";

export type FinancialUnit = {
  id: string;
  subjectType: "LEG" | "EVENT" | "IMPORT";
  subjectId: string | null;
  financialFactType: FinancialUnitType;
  actualSeconds: number;
  remunerableSeconds: number;
  guaranteeNumeratorSeconds: number;
  guaranteeDenominator: number;
  normalOperatingCandidateSeconds: number;
  deadheadCandidateSeconds: number;
  standbyEquivalentNumeratorSeconds: number;
  standbyEquivalentDenominator: number;
  reserveCandidateSeconds: number;
  specialTimePendingSeconds: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  provenance: { algorithm: string; version: string; policy?: string };
  attributes: Record<string, boolean | "PENDING">;
};

export type FinancialUnitInput = {
  importId: string;
  legs: Array<{ id: string; legType: "OPERATING" | "DEADHEAD"; durationMinutes: number | null }>;
  standby: Array<{ id: string; durationMinutes: number | null }>;
  reserve: Array<{ id: string; durationMinutes: number | null }>;
  deadheadPolicy: "SAME_AS_OPERATING_FOR_REMUNERATION" | "UNKNOWN";
};

function stableId(importId: string, type: FinancialUnitType, subjectId: string | null) {
  const hash = createHash("sha256").update(`${FLIGHT_FINANCIAL_UNITS_VERSION}:${importId}:${type}:${subjectId ?? "import"}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${(Number.parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16)}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function seconds(minutes: number | null) { return minutes === null || !Number.isFinite(minutes) || minutes < 0 ? null : Math.round(minutes * 60); }

function unit(input: Omit<FinancialUnit, "id">, importId: string): FinancialUnit {
  return { ...input, id: stableId(importId, input.financialFactType, input.subjectId) };
}

export function deriveFinancialUnits(input: FinancialUnitInput) {
  const units: FinancialUnit[] = [];
  for (const leg of input.legs) {
    const duration = seconds(leg.durationMinutes);
    if (duration === null) continue;
    const operating = leg.legType === "OPERATING";
    const eligibleDeadhead = leg.legType === "DEADHEAD" && input.deadheadPolicy === "SAME_AS_OPERATING_FOR_REMUNERATION";
    units.push(unit({ subjectType: "LEG", subjectId: leg.id, financialFactType: operating ? "OPERATING_REMUNERABLE_MINUTES" : "DEADHEAD_REMUNERABLE_MINUTES", actualSeconds: duration, remunerableSeconds: operating || eligibleDeadhead ? duration : 0, guaranteeNumeratorSeconds: operating ? duration : 0, guaranteeDenominator: 1, normalOperatingCandidateSeconds: operating ? duration : 0, deadheadCandidateSeconds: operating ? 0 : duration, standbyEquivalentNumeratorSeconds: 0, standbyEquivalentDenominator: 1, reserveCandidateSeconds: 0, specialTimePendingSeconds: operating ? duration : 0, confidence: operating || eligibleDeadhead ? "HIGH" : "LOW", provenance: { algorithm: operating ? "deriveOperatingRemunerableTime" : "deriveDeadheadRemunerableTime", version: FLIGHT_FINANCIAL_UNITS_VERSION, policy: operating ? undefined : input.deadheadPolicy }, attributes: { OPERATING: operating, DEADHEAD: !operating, STANDBY: false, RESERVE: false, NIGHT: "PENDING", SUNDAY: "PENDING", HOLIDAY: "PENDING" } }, input.importId));
  }
  for (const event of input.standby) {
    const duration = seconds(event.durationMinutes); if (duration === null) continue;
    units.push(unit({ subjectType: "EVENT", subjectId: event.id, financialFactType: "STANDBY_GUARANTEE_EQUIVALENT", actualSeconds: duration, remunerableSeconds: 0, guaranteeNumeratorSeconds: duration, guaranteeDenominator: 3, normalOperatingCandidateSeconds: 0, deadheadCandidateSeconds: 0, standbyEquivalentNumeratorSeconds: duration, standbyEquivalentDenominator: 3, reserveCandidateSeconds: 0, specialTimePendingSeconds: 0, confidence: "HIGH", provenance: { algorithm: "deriveStandbyEquivalent", version: FLIGHT_FINANCIAL_UNITS_VERSION, policy: "ONE_THIRD" }, attributes: { OPERATING: false, DEADHEAD: false, STANDBY: true, RESERVE: false, NIGHT: "PENDING", SUNDAY: "PENDING", HOLIDAY: "PENDING" } }, input.importId));
  }
  for (const event of input.reserve) {
    const duration = seconds(event.durationMinutes); if (duration === null) continue;
    units.push(unit({ subjectType: "EVENT", subjectId: event.id, financialFactType: "RESERVE_REMUNERABLE_MINUTES", actualSeconds: duration, remunerableSeconds: duration, guaranteeNumeratorSeconds: duration, guaranteeDenominator: 1, normalOperatingCandidateSeconds: 0, deadheadCandidateSeconds: 0, standbyEquivalentNumeratorSeconds: 0, standbyEquivalentDenominator: 1, reserveCandidateSeconds: duration, specialTimePendingSeconds: 0, confidence: "HIGH", provenance: { algorithm: "deriveReserveRemunerableTime", version: FLIGHT_FINANCIAL_UNITS_VERSION, policy: "SAME_AS_NORMAL_FLIGHT_HOUR" }, attributes: { OPERATING: false, DEADHEAD: false, STANDBY: false, RESERVE: true, NIGHT: "PENDING", SUNDAY: "PENDING", HOLIDAY: "PENDING" } }, input.importId));
  }
  const total = (key: keyof FinancialUnit) => units.reduce((sum, item) => sum + (typeof item[key] === "number" ? item[key] as number : 0), 0);
  units.push(unit({ subjectType: "IMPORT", subjectId: null, financialFactType: "PRELIMINARY_GUARANTEE_ACCUMULATOR", actualSeconds: total("actualSeconds"), remunerableSeconds: total("remunerableSeconds"), guaranteeNumeratorSeconds: 0, guaranteeDenominator: 1, normalOperatingCandidateSeconds: total("normalOperatingCandidateSeconds"), deadheadCandidateSeconds: total("deadheadCandidateSeconds"), standbyEquivalentNumeratorSeconds: total("standbyEquivalentNumeratorSeconds"), standbyEquivalentDenominator: 3, reserveCandidateSeconds: total("reserveCandidateSeconds"), specialTimePendingSeconds: total("specialTimePendingSeconds"), confidence: "HIGH", provenance: { algorithm: "derivePreliminaryGuaranteeAccumulator", version: FLIGHT_FINANCIAL_UNITS_VERSION }, attributes: { OPERATING: false, DEADHEAD: false, STANDBY: false, RESERVE: false, NIGHT: "PENDING", SUNDAY: "PENDING", HOLIDAY: "PENDING" } }, input.importId));
  return units;
}

export function rationalMinutes(numeratorSeconds: number, denominator: number) { return { numeratorSeconds, denominator }; }
