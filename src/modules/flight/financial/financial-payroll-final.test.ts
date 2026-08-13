import assert from "node:assert/strict";
import test from "node:test";
import { buildFinalPayrollReferences, buildPayrollBuckets, calculateGrossPayrollEstimate, PAYROLL_FIXED_CENTS, PAYROLL_RATES_CENTS } from "./financial-payroll";

const buckets = (normalHours: number) => buildPayrollBuckets([{ sourceActivity: "OPERATING", durationSeconds: normalHours * 3600, isNight: false, isSunday: false, isHoliday: false }]);
test("the 54 hour guarantee consumes normal payroll reference only", () => {
  assert.equal(buildFinalPayrollReferences(buckets(53)).payrollNormalSeconds, 0);
  assert.equal(buildFinalPayrollReferences(buckets(54)).payrollNormalSeconds, 0);
  assert.equal(buildFinalPayrollReferences(buckets(55)).payrollNormalSeconds, 3600);
});
test("gross estimate uses final references, observed rates and exact fixed components", () => {
  const references = buildFinalPayrollReferences(buckets(55)); const total = calculateGrossPayrollEstimate(references);
  assert.equal(total.variableAmounts[0], PAYROLL_RATES_CENTS.FLIGHT_HOUR_BASE);
  assert.equal(total.dsrAmountCents, PAYROLL_RATES_CENTS.DSR);
  assert.equal(total.variableHazardAmountCents, PAYROLL_RATES_CENTS.VARIABLE_HAZARD);
  assert.equal(total.fixedAmountCents, Object.values(PAYROLL_FIXED_CENTS).reduce((sum, value) => sum + value, 0));
});
test("special time fills the guarantee without removing its independent special payroll reference", () => {
  const values = buildPayrollBuckets([{ sourceActivity: "OPERATING", durationSeconds: 60 * 3600, isNight: false, isSunday: false, isHoliday: false }, { sourceActivity: "DEADHEAD", durationSeconds: 5 * 3600, isNight: true, isSunday: false, isHoliday: false }, { sourceActivity: "STANDBY", durationSeconds: 9 * 3600, isNight: false, isSunday: false, isHoliday: false, equivalenceNumeratorSeconds: 9 * 3600, equivalenceDenominator: 3 }]);
  const result = buildFinalPayrollReferences(values);
  assert.equal(result.guaranteeEligibleTotalSeconds, 68 * 3600);
  assert.equal(result.normalAboveGuaranteeSeconds, 14 * 3600);
  assert.ok(result.payrollNightNormalSeconds > 0);
});
