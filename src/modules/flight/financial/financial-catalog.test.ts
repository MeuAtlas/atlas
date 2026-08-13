import assert from "node:assert/strict";
import test from "node:test";
import { FLIGHT_ECONOMIC_PARAMETER_SEEDS, resolveCompensationProfile, totalFlightHourCents, type CompensationProfile } from "./financial-catalog";

const profile = (overrides: Partial<CompensationProfile> = {}): CompensationProfile => ({ id: "profile", userId: "user", effectiveFrom: "2026-08-01", effectiveTo: null, role: "COPILOT", roleEffectiveFrom: "2026-08-01", seniorityPercentage: "7.00", internalCommanderPromotionBonusPercentage: null, contractualBase: null, employmentRegime: null, sourceType: "USER_CONFIRMED_PROFILE_FACT", sourceReference: "confirmed", ...overrides });

test("financial profile keeps the confirmed COPILOT 7% profile temporal", () => {
  assert.equal(resolveCompensationProfile([profile()], "2026-08-15")?.role, "COPILOT");
  assert.equal(resolveCompensationProfile([profile()], "2026-08-15")?.seniorityPercentage, "7.00");
  assert.equal(resolveCompensationProfile([profile()], "2026-07-31"), null);
});

test("future COMMANDER profile does not alter a prior COPILOT period", () => {
  const current = profile({ effectiveTo: "2027-03-31" });
  const future = profile({ id: "commander", effectiveFrom: "2027-04-01", role: "COMMANDER", seniorityPercentage: "8.00" });
  assert.equal(resolveCompensationProfile([current, future], "2026-08-15")?.role, "COPILOT");
  assert.equal(resolveCompensationProfile([current, future], "2027-04-15")?.role, "COMMANDER");
});

test("flight-hour components and documented totals retain exact cents", () => {
  assert.equal(totalFlightHourCents(8947, 3253, 3660), 15860);
  assert.equal(FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "FLIGHT_HOUR_TOTAL" && item.role === "COMMANDER")?.valueCents, 28181);
  assert.equal(FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "FLIGHT_HOUR_TOTAL" && item.role === "COPILOT")?.valueCents, 15860);
});

test("catalog retains financial boundaries without calculating compensation", () => {
  const adjustment = FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "FUTURE_ECONOMIC_ADJUSTMENT");
  const standby = FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "STANDBY_EQUIVALENCE");
  const night = FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "NIGHT_WINDOW");
  assert.deepEqual([adjustment?.effectiveFrom, adjustment?.valueNumeric], ["2027-04-01", "10"]);
  assert.deepEqual(standby?.metadata, { numerator: 1, denominator: 3 });
  assert.deepEqual(night?.metadata, { start: "21:00", end: "09:00", timezone: "UTC" });
  assert.equal(FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "FLIGHT_HOUR_BASE" && item.role === "COPILOT")?.seniorityApplicable, false);
  assert.equal(FLIGHT_ECONOMIC_PARAMETER_SEEDS.find((item) => item.parameterKey === "SALARY_FLOOR" && item.role === "COPILOT")?.seniorityApplicable, true);
});
