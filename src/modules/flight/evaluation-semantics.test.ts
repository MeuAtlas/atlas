import assert from "node:assert/strict";
import test from "node:test";
import { deriveEvaluationSemantics, summarizeCompliance } from "./evaluation-semantics";

test("separates technical evaluation status from human compliance", () => {
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_STANDBY_DURATION", status: "PASS", evaluationContext: "NORMAL" }).complianceBucket, "COMPLIANT");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_STANDBY_DURATION", status: "FAIL", evaluationContext: "NORMAL" }).complianceBucket, "NON_COMPLIANT");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "LAW_GROUND_TRAINING_WORK_TIME_CLASSIFICATION", status: "PASS", evaluationContext: "NORMAL" }).complianceBucket, "INFORMATIONAL");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_RESERVE_ACCOMMODATION_TRIGGER", status: "PASS", evaluationContext: "TRIGGER" }).complianceBucket, "INFORMATIONAL");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_VOLUNTARY_168H_EXCEPTION", status: "PASS", evaluationContext: "EXCEPTION" }).complianceBucket, "INFORMATIONAL");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "RULESET_RESIDUAL_COVERAGE_DIAGNOSTIC", status: "PASS", evaluationContext: "NORMAL" }).complianceBucket, "INFORMATIONAL");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_STANDBY_DURATION", status: "UNKNOWN", evaluationContext: "NORMAL" }).complianceBucket, "NOT_EVALUABLE");
  assert.equal(deriveEvaluationSemantics({ ruleKey: "GOL_STANDBY_DURATION", status: "NOT_APPLICABLE", evaluationContext: "NORMAL" }).complianceBucket, "NOT_APPLICABLE");
});

test("aggregates compliance without counting triggers as attended requirements", () => {
  assert.deepEqual(summarizeCompliance([
    { ruleKey: "GOL_STANDBY_DURATION", status: "PASS", evaluationContext: "NORMAL" },
    { ruleKey: "LAW_GROUND_TRAINING_WORK_TIME_CLASSIFICATION", status: "PASS", evaluationContext: "TRIGGER" },
    { ruleKey: "GOL_STANDBY_DURATION", status: "UNKNOWN", evaluationContext: "NORMAL" },
    { ruleKey: "GOL_STANDBY_DURATION", status: "NOT_APPLICABLE", evaluationContext: "NORMAL" },
  ]), { confirmedCompliant: 1, confirmedViolations: 0, notEvaluable: 1, notApplicable: 1, informational: 1 });
});
