import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRbacAugmentedCrew, evaluateRbacExtension, evaluateRbacInDutyReprogramming, evaluateRbacInterruptedDuty } from "./rules-engine";

const augmented = { crewComposition: "COMPOSED", inflightRestClass: "CLASS_1", plannedInflightRestMinutes: 120, performsFinalLanding: "TRUE", operatingLegCount: 3, augmentedCrewEligibleFactsComplete: "TRUE" };

test("gates augmented crew and evaluates documented limits", () => {
  assert.equal(evaluateRbacAugmentedCrew("UNKNOWN", augmented, 480, 900, 500).status, "UNKNOWN");
  assert.equal(evaluateRbacAugmentedCrew("B", { ...augmented, crewComposition: "SIMPLE" }, 480, 900, 500).status, "NOT_APPLICABLE");
  assert.equal(evaluateRbacAugmentedCrew("B", { ...augmented, augmentedCrewEligibleFactsComplete: "FALSE" }, 480, 900, 500).status, "UNKNOWN");
  assert.equal(evaluateRbacAugmentedCrew("B", augmented, 480, 900, 500).status, "PASS");
  assert.equal(evaluateRbacAugmentedCrew("B", { ...augmented, plannedInflightRestMinutes: 89 }, 480, 900, 500).status, "FAIL");
  assert.equal(evaluateRbacAugmentedCrew("B", { ...augmented, operatingLegCount: 4 }, 480, 900, 500).status, "FAIL");
});

test("evaluates extension exceptions without independent false violations", () => {
  assert.equal(evaluateRbacExtension("RBAC117_DUTY_EXTENSION", "B", "SIMPLE", 60, "TRUE", "TRUE").status, "PASS");
  assert.equal(evaluateRbacExtension("RBAC117_DUTY_EXTENSION", "B", "SIMPLE", 61, "TRUE", "TRUE").status, "FAIL");
  assert.equal(evaluateRbacExtension("RBAC117_FLIGHT_TIME_EXTENSION", "B", "COMPOSED", 60, "TRUE", "TRUE").status, "PASS");
  assert.equal(evaluateRbacExtension("RBAC117_FLIGHT_TIME_EXTENSION", "B", "COMPOSED", 61, "TRUE", "TRUE").status, "FAIL");
  assert.equal(evaluateRbacExtension("RBAC117_ADDITIONAL_LEG_EXTENSION", "B", "SIMPLE", 0, "TRUE", "TRUE").status, "NOT_APPLICABLE");
  assert.equal(evaluateRbacExtension("RBAC117_ADDITIONAL_LEG_EXTENSION", "B", "SIMPLE", 1, "TRUE", "UNKNOWN").status, "UNKNOWN");
  assert.equal(evaluateRbacExtension("RBAC117_ADDITIONAL_LEG_EXTENSION", "B", "SIMPLE", 2, "TRUE", "TRUE").status, "FAIL");
});

test("evaluates reprogramming and interrupted-duty facts conservatively", () => {
  assert.equal(evaluateRbacInDutyReprogramming("B", { reprogrammingDetected: "FALSE" }, true).status, "NOT_APPLICABLE");
  assert.equal(evaluateRbacInDutyReprogramming("B", { reprogrammingDetected: "TRUE", reprogrammingAfterDutyStart: "UNKNOWN" }, true).status, "UNKNOWN");
  assert.equal(evaluateRbacInDutyReprogramming("B", { reprogrammingDetected: "TRUE", reprogrammingAfterDutyStart: "TRUE", fitnessDeclaration: "TRUE" }, true).status, "PASS");
  assert.equal(evaluateRbacInDutyReprogramming("B", { reprogrammingDetected: "TRUE", reprogrammingAfterDutyStart: "TRUE", fitnessDeclaration: "FALSE" }, true).status, "FAIL");
  const interrupted = { interruptedDutyDetected: "TRUE", interruptionMinutes: 230, interruptionTouches0000To0600: "FALSE", dutyOutsideContractualBase: "TRUE", accommodationType: "RESERVE_TYPE", restAccommodationConfirmed: "UNKNOWN", postInterruptionDutyMinutes: 150, interruptedDutyCount168h: 1, historyComplete168h: true };
  assert.equal(evaluateRbacInterruptedDuty("B", interrupted, 600).status, "UNKNOWN");
  assert.equal(evaluateRbacInterruptedDuty("B", { ...interrupted, restAccommodationConfirmed: "TRUE" }, 600).status, "PASS");
  assert.equal(evaluateRbacInterruptedDuty("B", { ...interrupted, restAccommodationConfirmed: "TRUE", postInterruptionDutyMinutes: 361 }, 600).status, "FAIL");
  assert.equal(evaluateRbacInterruptedDuty("B", { ...interrupted, restAccommodationConfirmed: "TRUE", interruptedDutyCount168h: 2 }, 600).status, "FAIL");
});
