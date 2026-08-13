import assert from "node:assert/strict";
import test from "node:test";
import { applyMonthlyGuarantee, buildPayrollBuckets, bucketFor, comparePayrollReference, payrollDecimalReference } from "./financial-payroll";

test("classifies deadhead by financial time without turning it into operating", () => {
  assert.equal(bucketFor({ isNight: true, isSunday: true, isHoliday: false }), "SUNDAY_HOLIDAY_NIGHT");
  const buckets = buildPayrollBuckets([{ sourceActivity: "DEADHEAD", durationSeconds: 3600, isNight: true, isSunday: true, isHoliday: false }]);
  assert.equal(buckets.SUNDAY_HOLIDAY_NIGHT.sourceSeconds.DEADHEAD, 3600);
});
test("applies standby one-third after temporal segmentation, without applying it twice", () => {
  const buckets = buildPayrollBuckets([{ sourceActivity: "STANDBY", durationSeconds: 180 * 60, isNight: false, isSunday: false, isHoliday: false, equivalenceNumeratorSeconds: 180 * 60, equivalenceDenominator: 3 }]);
  assert.equal(buckets.NORMAL.numeratorSeconds / buckets.NORMAL.denominator, 3600);
});
test("uses the eight over seven night equivalent exactly and applies the 54 hour guarantee only to normal", () => {
  const buckets = buildPayrollBuckets([{ sourceActivity: "OPERATING", durationSeconds: 55 * 3600, isNight: false, isSunday: false, isHoliday: false }, { sourceActivity: "OPERATING", durationSeconds: 3150, isNight: true, isSunday: false, isHoliday: false }]);
  assert.equal(buckets.NIGHT_NORMAL.numeratorSeconds / buckets.NIGHT_NORMAL.denominator, 3600);
  assert.equal(applyMonthlyGuarantee(buckets).normalAboveGuaranteeSeconds, 3600);
});
test("does not multiply equal rational denominators while accumulating night segments", () => {
  const buckets = buildPayrollBuckets([{ sourceActivity: "OPERATING", durationSeconds: 3150, isNight: true, isSunday: false, isHoliday: false }, { sourceActivity: "DEADHEAD", durationSeconds: 3150, isNight: true, isSunday: false, isHoliday: false }]);
  assert.equal(buckets.NIGHT_NORMAL.numeratorSeconds / buckets.NIGHT_NORMAL.denominator, 7200);
});
test("keeps payroll decimal references distinct from hour-minute notation", () => {
  assert.equal(payrollDecimalReference(26 * 3600 + 3 * 60), 26.05);
  assert.equal(comparePayrollReference(26 * 3600, 26).status, "MATCH");
});
