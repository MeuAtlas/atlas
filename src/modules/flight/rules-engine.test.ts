import assert from "node:assert/strict";
import test from "node:test";
import { consecutiveNightEarlyOccurrences, evaluateCghGruAdditionalRest, evaluateConsecutiveSingle, evaluateContractualBase, evaluateDifferentAirportBothRest, evaluateDifferentAirportPostRest, evaluateDifferentAirportPreRest, evaluateEarlyStartClassification, evaluateExceptionalOffDelay, evaluateGroundTime, evaluateInterairportTransportRequirement, evaluateMinimumRestAfterDuty, evaluateMonthlyOff, evaluateNightEarly168hLimit, evaluateNightEarly48hReset, evaluateNightEarlyConsecutiveLimit, evaluateNightOperationClassification, evaluateOffDelay, evaluateRbacAfterTwoNights, evaluateRbacNightReset, evaluateRbacPostFourNights, evaluateReserveAccommodationTrigger, evaluateReserveDuration, evaluateRestTransportDelay, evaluateSingleException, evaluateSingleExceptionAvailability, evaluateSingleNights, evaluateSingleReport, evaluateSingleRolling, evaluateStandbyDuration, evaluateStandbyMonthlyLimit, evaluateStandbyUncalledRest, evaluateThirdConsecutiveNightException, evaluateTimezoneCrossingRestIncrement, evaluateVirtualBaseStandbyReserveLocation, evaluateVoluntary168hException, evaluateWeekendOff, isNightOrEarlyOccurrence } from "./rules-engine";

test("standby limits", () => { assert.equal(evaluateStandbyDuration(179).status, "FAIL"); assert.equal(evaluateStandbyDuration(180).status, "PASS"); assert.equal(evaluateStandbyDuration(720).status, "PASS"); assert.equal(evaluateStandbyDuration(721).status, "FAIL"); assert.equal(evaluateStandbyDuration(null).status, "UNKNOWN"); });
test("reserve limits", () => { assert.equal(evaluateReserveDuration(179).status, "FAIL"); assert.equal(evaluateReserveDuration(180).status, "PASS"); assert.equal(evaluateReserveDuration(360).status, "PASS"); assert.equal(evaluateReserveDuration(361).status, "FAIL"); });
test("ground limits", () => { assert.equal(evaluateGroundTime("PLANNED", 180, "DAY").status, "PASS"); assert.equal(evaluateGroundTime("PLANNED", 181, "DAY").status, "FAIL"); assert.equal(evaluateGroundTime("PLANNED", 120, "NIGHT").status, "PASS"); assert.equal(evaluateGroundTime("PLANNED", 121, "NIGHT").status, "FAIL"); assert.equal(evaluateGroundTime("EXECUTION_SNAPSHOT", 121, "NIGHT").status, "NOT_APPLICABLE"); });
test("monthly standby cap requires known non-voluntary context only after the cap", () => { const confirmed = Array.from({ length: 9 }, (_, index) => ({ id: String(index), voluntaryTradeContext: false, origin: "OPERATOR" })); assert.equal(evaluateStandbyMonthlyLimit(confirmed.slice(0, 8), true).status, "PASS"); assert.equal(evaluateStandbyMonthlyLimit(confirmed, true).status, "FAIL"); assert.equal(evaluateStandbyMonthlyLimit([...confirmed.slice(0, 8), { id: "unknown", voluntaryTradeContext: "UNKNOWN", origin: "UNKNOWN" }], true).status, "UNKNOWN"); assert.equal(evaluateStandbyMonthlyLimit(confirmed, false).status, "NOT_APPLICABLE"); });
test("uncalled standby rest only applies when called is documented false", () => { const end = "2026-08-01T12:00:00.000Z"; assert.equal(evaluateStandbyUncalledRest(true, end, "2026-08-02T00:00:00.000Z").status, "NOT_APPLICABLE"); assert.equal(evaluateStandbyUncalledRest("UNKNOWN", end, "2026-08-02T00:00:00.000Z").status, "UNKNOWN"); assert.equal(evaluateStandbyUncalledRest(false, end, "2026-08-01T23:59:00.000Z").status, "FAIL"); assert.equal(evaluateStandbyUncalledRest(false, end, "2026-08-02T00:00:00.000Z").status, "PASS"); assert.equal(evaluateStandbyUncalledRest(false, end, null).status, "UNKNOWN"); });
test("reserve accommodation identifies only the legal trigger", () => { const atLimit = evaluateReserveAccommodationTrigger(180, true); const above = evaluateReserveAccommodationTrigger(181, true); assert.equal(atLimit.status, "NOT_APPLICABLE"); assert.equal(above.status, "PASS"); assert.equal(above.evaluationContext, "TRIGGER"); assert.match(above.explanation, /requirement_triggered = true/); assert.match(above.explanation, /accommodation_provided = UNKNOWN/); assert.equal(evaluateReserveAccommodationTrigger(360, true).status, "PASS"); });
test("uses duty facts for night and early classifications without recalculating time boundaries", () => { assert.equal(evaluateNightOperationClassification(true).status, "PASS"); assert.equal(evaluateNightOperationClassification(false).status, "NOT_APPLICABLE"); assert.equal(evaluateNightOperationClassification("UNKNOWN").status, "UNKNOWN"); assert.equal(evaluateEarlyStartClassification(true).status, "PASS"); assert.equal(evaluateEarlyStartClassification(false).status, "NOT_APPLICABLE"); assert.equal(evaluateEarlyStartClassification(null).status, "UNKNOWN"); });
test("counts a duty classified as night and early only once", () => { assert.equal(isNightOrEarlyOccurrence({ isNightOperation: true, isEarlyStart: true }), true); assert.equal(consecutiveNightEarlyOccurrences([true, true, false, true]), 2); });
test("keeps consecutive and 168h limits unknown when an unevaluated exception or history applies", () => { assert.equal(evaluateNightEarlyConsecutiveLimit(1, true).status, "PASS"); assert.equal(evaluateNightEarlyConsecutiveLimit(2, true).status, "PASS"); assert.equal(evaluateNightEarlyConsecutiveLimit(3, true).status, "UNKNOWN"); assert.equal(evaluateNightEarlyConsecutiveLimit(1, false).status, "UNKNOWN"); assert.equal(evaluateNightEarly168hLimit(3, true).status, "PASS"); assert.equal(evaluateNightEarly168hLimit(4, true).status, "PASS"); assert.equal(evaluateNightEarly168hLimit(5, true).status, "UNKNOWN"); assert.equal(evaluateNightEarly168hLimit(3, false).status, "UNKNOWN"); });
test("evaluates only the documented 48h reset fact", () => { assert.equal(evaluateNightEarly48hReset(true).status, "PASS"); assert.equal(evaluateNightEarly48hReset(false).status, "NOT_APPLICABLE"); assert.equal(evaluateNightEarly48hReset("UNKNOWN").status, "UNKNOWN"); });
test("evaluates third consecutive exception only from all required facts", () => { const facts = { extraService: true, returnToContractualBase: true, endsDuty: true, noOperatingCrewBeforeThirdOccurrenceInSameDuty: true }; assert.equal(evaluateThirdConsecutiveNightException(false, facts).status, "NOT_APPLICABLE"); assert.equal(evaluateThirdConsecutiveNightException(true, facts).status, "PASS"); assert.equal(evaluateThirdConsecutiveNightException(true, { ...facts, extraService: false }).status, "FAIL"); assert.equal(evaluateThirdConsecutiveNightException(true, { ...facts, extraService: "UNKNOWN" }).status, "UNKNOWN"); });
test("evaluates 168h voluntary exception independently", () => { const facts = { changeVoluntary: true, changeOrigin: "PORTAL_TRADE", purpose: "MAINTAIN_ORIGINAL_PROGRAMMING", operationalDisruption: true, unplannedNightWindowInserted: true }; assert.equal(evaluateVoluntary168hException(4, facts).status, "NOT_APPLICABLE"); assert.equal(evaluateVoluntary168hException(5, facts).status, "PASS"); assert.equal(evaluateVoluntary168hException(5, { ...facts, changeVoluntary: false }).status, "FAIL"); assert.equal(evaluateVoluntary168hException(5, { ...facts, changeOrigin: "UNKNOWN" }).status, "UNKNOWN"); });
test("gates every RBAC rule when the operator regime is unknown", () => { assert.equal(evaluateRbacAfterTwoNights("UNKNOWN", 2, true, 420, false).status, "UNKNOWN"); assert.equal(evaluateRbacPostFourNights("UNKNOWN", 4, true, 2).status, "UNKNOWN"); assert.equal(evaluateRbacNightReset("UNKNOWN", true, 2).status, "UNKNOWN"); });
test("evaluates RBAC after two nights including voluntary uncertainty", () => { assert.equal(evaluateRbacAfterTwoNights("B", 1, true, 420, false).status, "NOT_APPLICABLE"); assert.equal(evaluateRbacAfterTwoNights("B", 2, true, 359, false).status, "PASS"); assert.equal(evaluateRbacAfterTwoNights("B", 2, true, 420, false).status, "FAIL"); assert.equal(evaluateRbacAfterTwoNights("B", 2, false, 420, false).status, "UNKNOWN"); assert.equal(evaluateRbacAfterTwoNights("B", 2, true, 420, true).status, "UNKNOWN"); });
test("evaluates RBAC post-four-nights using night-only count", () => { assert.equal(evaluateRbacPostFourNights("B", 3, true, 0).status, "NOT_APPLICABLE"); assert.equal(evaluateRbacPostFourNights("B", 4, true, 0).status, "PASS"); assert.equal(evaluateRbacPostFourNights("B", 4, true, 1).status, "PASS"); assert.equal(evaluateRbacPostFourNights("B", 4, true, 2).status, "FAIL"); assert.equal(evaluateRbacPostFourNights("B", 4, false, 0).status, "UNKNOWN"); });
test("evaluates the stricter RBAC reset independently from ACT reset", () => { assert.equal(evaluateRbacNightReset("B", true, 2).status, "PASS"); assert.equal(evaluateRbacNightReset("B", true, 3).status, "PASS"); assert.equal(evaluateRbacNightReset("B", true, 1).status, "FAIL"); assert.equal(evaluateRbacNightReset("B", false, 2).status, "NOT_APPLICABLE"); assert.equal(evaluateRbacNightReset("B", "UNKNOWN", 2).status, "UNKNOWN"); assert.equal(evaluateRbacNightReset("B", true, null).status, "UNKNOWN"); });
test("evaluates monthly OFF and grouped weekend conditions", () => {
  assert.equal(evaluateMonthlyOff(null, "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateMonthlyOff(10, "UNKNOWN").status, "PASS");
  assert.equal(evaluateMonthlyOff(9, true).status, "PASS");
  assert.equal(evaluateMonthlyOff(8, true).status, "PASS");
  assert.equal(evaluateMonthlyOff(7, true).status, "FAIL");
  assert.equal(evaluateMonthlyOff(9, false).status, "FAIL");
  assert.equal(evaluateMonthlyOff(9, "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateWeekendOff(true, true).status, "PASS");
  assert.equal(evaluateWeekendOff(false, false).status, "FAIL");
  assert.equal(evaluateWeekendOff(true, false).status, "FAIL");
});
test("evaluates OFF delays and exceptional reasons", () => {
  assert.equal(evaluateOffDelay(0, "UNKNOWN").status, "PASS");
  assert.equal(evaluateOffDelay(225, "UNKNOWN").status, "PASS");
  assert.equal(evaluateOffDelay(240, "UNKNOWN").status, "PASS");
  assert.equal(evaluateExceptionalOffDelay(241, "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateExceptionalOffDelay(241, "WEATHER").status, "PASS");
  assert.equal(evaluateExceptionalOffDelay(720, "WEATHER").status, "PASS");
  assert.equal(evaluateExceptionalOffDelay(721, "WEATHER").status, "FAIL");
});
test("evaluates single OFF nights, local next report, rolling and consecutive facts", () => {
  assert.equal(evaluateSingleNights(2).status, "PASS");
  assert.equal(evaluateSingleNights(1).status, "FAIL");
  assert.equal(evaluateSingleNights("UNKNOWN").status, "UNKNOWN");
  const failedException = { status: "FAIL" as const };
  const passedException = evaluateSingleException(true, true, true);
  assert.equal(evaluateSingleReport("FLIGHT", "2026-08-01T12:59:00.000Z", "America/Sao_Paulo", failedException.status).status, "FAIL");
  assert.equal(evaluateSingleReport("FLIGHT", "2026-08-01T13:00:00.000Z", "America/Sao_Paulo", failedException.status).status, "FAIL");
  assert.equal(evaluateSingleReport("FLIGHT", "2026-08-01T13:01:00.000Z", "America/Sao_Paulo", failedException.status).status, "PASS");
  assert.equal(evaluateSingleReport("GROUND_TRAINING", null, null, "UNKNOWN").status, "NOT_APPLICABLE");
  assert.equal(evaluateSingleReport("FLIGHT", "2026-08-01T13:00:00.000Z", "America/Sao_Paulo", passedException.status).status, "PASS");
  assert.equal(evaluateSingleReport("FLIGHT", "2026-08-01T13:00:00.000Z", "America/Sao_Paulo", "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateSingleRolling(2, true, "2026-08-01", failedException.status).status, "PASS");
  assert.equal(evaluateSingleRolling(3, true, "2026-08-01", failedException.status).status, "FAIL");
  assert.equal(evaluateSingleRolling(3, true, "2026-08-01", passedException.status).status, "PASS");
  assert.equal(evaluateSingleRolling(2, false, "2026-08-01", failedException.status).status, "UNKNOWN");
  assert.equal(evaluateConsecutiveSingle("FALSE", "2026-08-01", failedException.status).status, "PASS");
  assert.equal(evaluateConsecutiveSingle("TRUE", "2026-08-01", passedException.status).status, "PASS");
  assert.equal(evaluateConsecutiveSingle("TRUE", "2026-08-01", failedException.status).status, "FAIL");
  assert.equal(evaluateConsecutiveSingle("UNKNOWN", "2026-08-01", failedException.status).status, "UNKNOWN");
});

test("does not count an unavailable voluntary single-OFF exception as an independent failure", () => {
  assert.equal(evaluateSingleExceptionAvailability("UNKNOWN", "UNKNOWN", false, true).evaluation.status, "NOT_APPLICABLE");
  assert.equal(evaluateSingleExceptionAvailability("UNKNOWN", "UNKNOWN", false, true).compositionStatus, "FAIL");
  assert.equal(evaluateSingleExceptionAvailability("UNKNOWN", "UNKNOWN", true, false).evaluation.status, "NOT_APPLICABLE");
  assert.equal(evaluateSingleExceptionAvailability("UNKNOWN", "UNKNOWN", true, true).evaluation.status, "UNKNOWN");
  assert.equal(evaluateSingleExceptionAvailability(true, true, true, true).evaluation.status, "PASS");
  assert.equal(evaluateSingleException(false, true, true).status, "NOT_APPLICABLE");
});

test("evaluates legal minimum rest at all duty-duration boundaries", () => {
  assert.equal(evaluateMinimumRestAfterDuty(720, 720).status, "PASS");
  assert.equal(evaluateMinimumRestAfterDuty(720, 719).status, "FAIL");
  assert.equal(evaluateMinimumRestAfterDuty(721, 959).status, "FAIL");
  assert.equal(evaluateMinimumRestAfterDuty(721, 960).status, "PASS");
  assert.equal(evaluateMinimumRestAfterDuty(900, 960).status, "PASS");
  assert.equal(evaluateMinimumRestAfterDuty(901, 1439).status, "FAIL");
  assert.equal(evaluateMinimumRestAfterDuty(901, 1440).status, "PASS");
  assert.equal(evaluateMinimumRestAfterDuty(null, 720).status, "UNKNOWN");
});

test("qualifies contractual base and independent airport increments", () => {
  assert.equal(evaluateContractualBase("CGH", "CGH").status, "PASS");
  assert.equal(evaluateContractualBase("CGH", "GRU").status, "UNKNOWN");
  assert.equal(evaluateDifferentAirportPreRest("GRU", "CGH").fact, 60);
  assert.equal(evaluateDifferentAirportPostRest("GRU", "CGH").fact, 60);
  assert.equal(evaluateDifferentAirportBothRest("GRU", "GRU", "CGH").fact, 120);
  assert.equal(evaluateDifferentAirportBothRest("CGH", "GRU", "CGH").status, "NOT_APPLICABLE");
});

test("evaluates CGH/GRU, timezone and transport facts without composition", () => {
  assert.equal(evaluateCghGruAdditionalRest("2026-02-28", "CGH", ["GRU"], false, "UNKNOWN").status, "NOT_APPLICABLE");
  assert.equal(evaluateCghGruAdditionalRest("2026-03-01", "CGH", ["GRU"], false, "UNKNOWN").fact, 60);
  assert.equal(evaluateCghGruAdditionalRest("2026-03-01", "CGH", ["GRU"], true, "PORTAL_TRADE").status, "NOT_APPLICABLE");
  assert.equal(evaluateCghGruAdditionalRest("2026-03-01", "CGH", ["GRU"], "UNKNOWN", "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateCghGruAdditionalRest("2026-03-01", "BSB", ["CGH"], false, "UNKNOWN").status, "NOT_APPLICABLE");
  assert.equal(evaluateTimezoneCrossingRestIncrement(2, true).status, "NOT_APPLICABLE");
  assert.equal(evaluateTimezoneCrossingRestIncrement(3, true).fact, 360);
  assert.equal(evaluateTimezoneCrossingRestIncrement(4, true).fact, 480);
  assert.equal(evaluateTimezoneCrossingRestIncrement(3, "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateRestTransportDelay("2026-08-01T20:00:00.000Z", "2026-08-01T20:00:00.000Z").fact, 0);
  assert.equal(evaluateRestTransportDelay("2026-08-01T20:00:00.000Z", "2026-08-01T20:45:00.000Z").fact, 45);
  assert.equal(evaluateRestTransportDelay("2026-08-01T20:00:00.000Z", null).status, "UNKNOWN");
});

test("evaluates transport trigger and virtual-base location requirement", () => {
  assert.equal(evaluateInterairportTransportRequirement("CGH", "CGH", "GRU").status, "PASS");
  assert.equal(evaluateInterairportTransportRequirement("CGH", "CGH", "CGH").status, "NOT_APPLICABLE");
  assert.equal(evaluateVirtualBaseStandbyReserveLocation("UNKNOWN", "CGH", "CGH", "CGH").status, "UNKNOWN");
  assert.equal(evaluateVirtualBaseStandbyReserveLocation("INACTIVE", "CGH", "CGH", "CGH").status, "NOT_APPLICABLE");
  assert.equal(evaluateVirtualBaseStandbyReserveLocation("ACTIVE", "CGH", "CGH", "CGH").status, "PASS");
  assert.equal(evaluateVirtualBaseStandbyReserveLocation("ACTIVE", "CGH", "GRU", "CGH").status, "FAIL");
});
