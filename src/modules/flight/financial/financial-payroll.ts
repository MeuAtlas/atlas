export const FLIGHT_PAYROLL_ENGINE_VERSION = "flight-payroll/1.0.0";

export type SourceActivity = "OPERATING" | "DEADHEAD" | "STANDBY" | "RESERVE";
export type PayBucket = "NORMAL" | "NIGHT_NORMAL" | "SUNDAY_HOLIDAY_DAY" | "SUNDAY_HOLIDAY_NIGHT";
export type PayrollSegment = { sourceActivity: SourceActivity; durationSeconds: number; isNight: boolean; isSunday: boolean; isHoliday: boolean; nightEquivalentNumeratorSeconds?: number; nightEquivalentDenominator?: number; equivalenceNumeratorSeconds?: number; equivalenceDenominator?: number };
export type PayrollBuckets = Record<PayBucket, { numeratorSeconds: number; denominator: number; sourceSeconds: Record<SourceActivity, number> }>;
export const MONTHLY_GUARANTEE_SECONDS = 54 * 60 * 60;
export const PAYROLL_RATES_CENTS = { FLIGHT_HOUR_BASE: 8947, DSR: 3253, VARIABLE_HAZARD: 3660 } as const;
export const PAYROLL_FIXED_CENTS = { SALARY: 752160, ORGANIC_COMPENSATION: 150432, HAZARD_SALARY: 225648, HAZARD_ORGANIC: 45130, SENIORITY: 63181, FAM: 10000 } as const;

const empty = (): PayrollBuckets => ({ NORMAL: { numeratorSeconds: 0, denominator: 1, sourceSeconds: { OPERATING: 0, DEADHEAD: 0, STANDBY: 0, RESERVE: 0 } }, NIGHT_NORMAL: { numeratorSeconds: 0, denominator: 1, sourceSeconds: { OPERATING: 0, DEADHEAD: 0, STANDBY: 0, RESERVE: 0 } }, SUNDAY_HOLIDAY_DAY: { numeratorSeconds: 0, denominator: 1, sourceSeconds: { OPERATING: 0, DEADHEAD: 0, STANDBY: 0, RESERVE: 0 } }, SUNDAY_HOLIDAY_NIGHT: { numeratorSeconds: 0, denominator: 1, sourceSeconds: { OPERATING: 0, DEADHEAD: 0, STANDBY: 0, RESERVE: 0 } } });
const gcd = (left: number, right: number): number => right === 0 ? left : gcd(right, left % right);

export function payrollDecimalReference(seconds: number, decimals = 2) { return Number((seconds / 3600).toFixed(decimals)); }
export function bucketFor(segment: Pick<PayrollSegment, "isNight" | "isSunday" | "isHoliday">): PayBucket { const special = segment.isSunday || segment.isHoliday; return special ? segment.isNight ? "SUNDAY_HOLIDAY_NIGHT" : "SUNDAY_HOLIDAY_DAY" : segment.isNight ? "NIGHT_NORMAL" : "NORMAL"; }

export function buildPayrollBuckets(segments: readonly PayrollSegment[]): PayrollBuckets {
  const buckets = empty();
  for (const segment of segments) {
    if (segment.durationSeconds <= 0) continue;
    const bucket = buckets[bucketFor(segment)];
    const denominator = segment.equivalenceDenominator ?? (segment.isNight ? (segment.nightEquivalentDenominator ?? 7) : 1);
    const numerator = segment.equivalenceNumeratorSeconds ?? (segment.isNight ? (segment.nightEquivalentNumeratorSeconds ?? segment.durationSeconds * 8) : segment.durationSeconds);
    if (bucket.denominator === 1 && bucket.numeratorSeconds === 0) bucket.denominator = denominator;
    const common = bucket.denominator * denominator / gcd(bucket.denominator, denominator);
    bucket.numeratorSeconds = bucket.numeratorSeconds * (common / bucket.denominator) + numerator * (common / denominator);
    bucket.denominator = common;
    bucket.sourceSeconds[segment.sourceActivity] += segment.durationSeconds;
  }
  return buckets;
}

export function applyMonthlyGuarantee(buckets: PayrollBuckets) {
  const normalSeconds = buckets.NORMAL.numeratorSeconds / buckets.NORMAL.denominator;
  const consumedSeconds = Math.min(normalSeconds, MONTHLY_GUARANTEE_SECONDS);
  return { guaranteeSeconds: MONTHLY_GUARANTEE_SECONDS, consumedSeconds, normalWithinGuaranteeSeconds: consumedSeconds, normalAboveGuaranteeSeconds: Math.max(0, normalSeconds - consumedSeconds) };
}

export type FinalPayrollReferences = {
  guaranteeTargetSeconds: number; guaranteeEligibleTotalSeconds: number; guaranteeConsumedSeconds: number;
  normalWithinGuaranteeSeconds: number; normalAboveGuaranteeSeconds: number;
  guaranteeEligibleOperatingSeconds: number; guaranteeEligibleDeadheadSeconds: number; guaranteeEligibleStandbyEquivalentSeconds: number; guaranteeEligibleReserveSeconds: number;
  payrollNormalSeconds: number; payrollNightNormalSeconds: number; payrollSundayHolidayDaySeconds: number; payrollSundayHolidayNightSeconds: number; totalPayrollReferenceSeconds: number;
};

export function buildFinalPayrollReferences(buckets: PayrollBuckets): FinalPayrollReferences {
  const allSources = (activity: SourceActivity) => Object.values(buckets).reduce((sum, bucket) => sum + bucket.sourceSeconds[activity], 0);
  const operating = allSources("OPERATING"); const deadhead = allSources("DEADHEAD"); const standby = allSources("STANDBY") / 3; const reserve = allSources("RESERVE");
  const eligible = operating + deadhead + standby + reserve;
  const guarantee = { guaranteeSeconds: MONTHLY_GUARANTEE_SECONDS, consumedSeconds: Math.min(eligible, MONTHLY_GUARANTEE_SECONDS), normalWithinGuaranteeSeconds: Math.min(eligible, MONTHLY_GUARANTEE_SECONDS), normalAboveGuaranteeSeconds: Math.max(0, eligible - MONTHLY_GUARANTEE_SECONDS) };
  const night = buckets.NIGHT_NORMAL.numeratorSeconds / buckets.NIGHT_NORMAL.denominator;
  const sundayDay = buckets.SUNDAY_HOLIDAY_DAY.numeratorSeconds / buckets.SUNDAY_HOLIDAY_DAY.denominator;
  const sundayNight = buckets.SUNDAY_HOLIDAY_NIGHT.numeratorSeconds / buckets.SUNDAY_HOLIDAY_NIGHT.denominator;
  const total = guarantee.normalAboveGuaranteeSeconds + night + sundayDay + sundayNight;
  return { guaranteeTargetSeconds: guarantee.guaranteeSeconds, guaranteeEligibleTotalSeconds: eligible, guaranteeConsumedSeconds: guarantee.consumedSeconds, normalWithinGuaranteeSeconds: guarantee.normalWithinGuaranteeSeconds, normalAboveGuaranteeSeconds: guarantee.normalAboveGuaranteeSeconds, guaranteeEligibleOperatingSeconds: operating, guaranteeEligibleDeadheadSeconds: deadhead, guaranteeEligibleStandbyEquivalentSeconds: standby, guaranteeEligibleReserveSeconds: reserve, payrollNormalSeconds: guarantee.normalAboveGuaranteeSeconds, payrollNightNormalSeconds: night, payrollSundayHolidayDaySeconds: sundayDay, payrollSundayHolidayNightSeconds: sundayNight, totalPayrollReferenceSeconds: total };
}

export function calculateGrossPayrollEstimate(references: FinalPayrollReferences) {
  const variableReferences = [references.payrollNormalSeconds, references.payrollNightNormalSeconds, references.payrollSundayHolidayDaySeconds, references.payrollSundayHolidayNightSeconds];
  const baseAmounts = variableReferences.map(seconds => Math.round(seconds / 3600 * PAYROLL_RATES_CENTS.FLIGHT_HOUR_BASE));
  const totalReferenceHours = references.totalPayrollReferenceSeconds / 3600;
  const dsr = Math.round(totalReferenceHours * PAYROLL_RATES_CENTS.DSR);
  const hazard = Math.round(totalReferenceHours * PAYROLL_RATES_CENTS.VARIABLE_HAZARD);
  const fixed = Object.values(PAYROLL_FIXED_CENTS).reduce((sum, value) => sum + value, 0);
  return { variableAmounts: baseAmounts, dsrAmountCents: dsr, variableHazardAmountCents: hazard, fixedAmountCents: fixed, grossAmountCents: fixed + baseAmounts.reduce((sum, value) => sum + value, 0) + dsr + hazard };
}

export function comparePayrollReference(atlasSeconds: number, payrollReference: number) {
  const atlasReference = payrollDecimalReference(atlasSeconds);
  const difference = Number((atlasReference - payrollReference).toFixed(2));
  const differenceMinutesEquivalent = Math.round(difference * 60);
  const differencePercentage = payrollReference === 0 ? null : Number((difference / payrollReference * 100).toFixed(2));
  return { atlasReference, payrollReference, difference, differenceMinutesEquivalent, differencePercentage, status: Math.abs(difference) <= 0.1 ? "MATCH" : Math.abs(difference) <= 0.5 ? "NEAR_MATCH" : "REVIEW_REQUIRED" as "MATCH" | "NEAR_MATCH" | "REVIEW_REQUIRED" };
}
