import assert from "node:assert/strict";
import test from "node:test";
import { validateFactsForPersistence } from "./flight-facts-validation";
import type { FactRecord } from "./flight-facts";

const change = (changeType: string): FactRecord => ({
  factKey: "schedule_change",
  subjectType: "SCHEDULE_CHANGE",
  subjectId: "ce127ec2-652f-418c-8c07-e0477c7a8971",
  value: { changeType, plannedReference: "duty-planned", executedReference: "duty-executed" },
  sourceType: "CALCULATED",
  confidence: "HIGH",
  provenance: { algorithm: "test" },
});

test("persists independent duty report and release changes without violating subject uniqueness", () => {
  const facts = [change("DUTY_CHANGED"), change("REPORT_TIME_CHANGED"), change("RELEASE_TIME_CHANGED")];
  const validation = validateFactsForPersistence(facts);

  assert.equal(validation.valid, true);
  assert.equal(facts[0].subjectId, "ce127ec2-652f-418c-8c07-e0477c7a8971");
  assert.equal(facts[1].subjectId, null);
  assert.equal(facts[2].subjectId, null);
});
