import assert from "node:assert/strict";
import test from "node:test";
import { buildFlightRuleEvaluations } from "./rules-engine-service";

const facts = [{ fact_key: "standby", subject_type: "EVENT", subject_id: "standby-1", value: { durationMinutes: 180, regime: "REGULAR", called: "UNKNOWN", voluntaryTradeContext: "UNKNOWN" }, confidence: "HIGH" as const }, { fact_key: "ground_interval", subject_type: "GROUND_INTERVAL", subject_id: null, value: { minutes: 121, classification: "NIGHT" }, confidence: "HIGH" as const }];
test("builds source-referenced evaluations from persisted facts", () => { const result = buildFlightRuleEvaluations("PLANNED", facts); const standby = result.find((evaluation) => evaluation.ruleKey === "GOL_STANDBY_DURATION"); assert.equal(result.length, 31); assert.equal(standby?.status, "PASS"); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_GROUND_TIME_BETWEEN_LEGS")?.status, "FAIL"); assert.deepEqual(standby?.sourceReferences, [{ instrumentId: "a49d8597-8372-4682-9e3b-4f97d4b21944", clause: "5.13" }]); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_STANDBY_MONTHLY_LIMIT")?.status, "PASS"); });
test("keeps snapshot ground intervals not applicable", () => { const result = buildFlightRuleEvaluations("EXECUTION_SNAPSHOT", facts); assert.equal(result[2].status, "NOT_APPLICABLE"); });
test("is deterministic and keeps import-state evaluations isolated", () => { const planned = buildFlightRuleEvaluations("PLANNED", facts); const repeated = buildFlightRuleEvaluations("PLANNED", facts); const snapshot = buildFlightRuleEvaluations("EXECUTION_SNAPSHOT", facts); assert.deepEqual(repeated, planned); assert.equal(planned[2].status, "FAIL"); assert.equal(snapshot[2].status, "NOT_APPLICABLE"); });
test("preserves unknown when documentary duration is unavailable", () => { const result = buildFlightRuleEvaluations("PLANNED", [{ fact_key: "reserve", subject_type: "EVENT", subject_id: "reserve-1", value: { durationMinutes: null }, confidence: "LOW" }]); assert.equal(result[0].status, "UNKNOWN"); });
test("persists the reserve trigger separately from duration", () => { const result = buildFlightRuleEvaluations("PLANNED", [{ fact_key: "reserve", subject_type: "EVENT", subject_id: "reserve-1", value: { durationMinutes: 181 }, confidence: "HIGH" }]); const trigger = result.find((evaluation) => evaluation.ruleKey === "GOL_RESERVE_ACCOMMODATION_TRIGGER"); assert.equal(trigger?.status, "PASS"); assert.equal(trigger?.evaluationContext, "TRIGGER"); assert.equal(trigger?.factsSnapshot.accommodationProvided, "UNKNOWN"); });
test("uses supplied duty classifications at time boundaries without recalculation", () => { const result = buildFlightRuleEvaluations("PLANNED", [{ fact_key: "duty", subject_type: "DUTY", subject_id: "boundary", value: { presentationAt: "2026-08-01T04:00:00.000Z", isNightOperation: false, isEarlyStart: true }, confidence: "HIGH" }, { fact_key: "rolling_window", subject_type: "WINDOW", subject_id: null, value: { windowType: "night_early_count_168h", value: 1, historyComplete: true }, confidence: "HIGH" }, { fact_key: "free_interval_48h", subject_type: "WINDOW", subject_id: null, value: { freeInterval48h: true }, confidence: "HIGH" }]); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_NIGHT_OPERATION_CLASSIFICATION")?.status, "NOT_APPLICABLE"); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_EARLY_START_CLASSIFICATION")?.status, "PASS"); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_NIGHT_EARLY_168H_LIMIT")?.status, "PASS"); assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_NIGHT_EARLY_48H_RESET")?.status, "PASS"); });

test("evaluates Pacote 5 only from persisted OFF facts", () => {
  const result = buildFlightRuleEvaluations("PLANNED", [
    { fact_key: "off_period", subject_type: "OFF_PERIOD", subject_id: "weekend", value: { offDayCount: 9, isWeekendGroupedCandidate: true, startAt: "2026-08-01T14:00:00.000Z", isSingleOff: false, monthAttribution: "2026-08" }, confidence: "HIGH" },
    { fact_key: "off_period", subject_type: "OFF_PERIOD", subject_id: "single", value: { offDayCount: 1, isSingleOff: true, localNightsCount: 2, nextActivityType: "FLIGHT", nextActivityStartAt: "2026-08-02T13:01:00.000Z", nextActivityTimezone: "America/Sao_Paulo", isConsecutiveSingleOff: "FALSE", monthAttribution: "2026-08" }, confidence: "HIGH" },
    { fact_key: "off_substitution", subject_type: "OFF_SUBSTITUTION", subject_id: "single", value: { changeVoluntary: "UNKNOWN", programSubstitution: "UNKNOWN", generatedSingleOff: "FALSE" }, confidence: "MEDIUM" },
    { fact_key: "single_off_count_30d", subject_type: "OFF_PERIOD", subject_id: "single", value: { value: 1, historyComplete: true }, confidence: "HIGH" },
    { fact_key: "off_period_match", subject_type: "OFF_PERIOD_MATCH", subject_id: "match", value: { matchingStatus: "MATCHED", matchingConfidence: "HIGH", deltaStartMinutes: 225, reason: "UNKNOWN" }, confidence: "HIGH" },
  ]);
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_MONTHLY_OFF_MINIMUM")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_MONTHLY_GROUPED_WEEKEND_OFF")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_OFF_START_DELAY")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_OFF_EXCEPTIONAL_START_DELAY")?.status, "NOT_APPLICABLE");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_SINGLE_OFF_TWO_LOCAL_NIGHTS")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_SINGLE_OFF_NEXT_REPORT_TIME")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_SINGLE_OFF_ROLLING_30D_LIMIT")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION")?.status, "NOT_APPLICABLE");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_OFF_MONTH_ATTRIBUTION")?.status, "PASS");
  assert.deepEqual(result.find((evaluation) => evaluation.ruleKey === "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION")?.sourceReferences, [{ instrumentId: "a49d8597-8372-4682-9e3b-4f97d4b21944", clause: "7.4 §6" }]);
});

test("builds independent Package 6 rest and base evaluations from persisted facts", () => {
  const result = buildFlightRuleEvaluations("PLANNED", [
    { fact_key: "duty", subject_type: "DUTY", subject_id: "previous", value: { durationMinutes: 720, startAirport: "GRU", endAirport: "GRU" }, confidence: "HIGH" },
    { fact_key: "duty", subject_type: "DUTY", subject_id: "next", value: { durationMinutes: 300, startAirport: "GRU", endAirport: "CGH" }, confidence: "HIGH" },
    { fact_key: "rest_interval", subject_type: "REST", subject_id: null, value: { previousDutyId: "previous", nextDutyId: "next", startAt: "2026-08-01T20:00:00.000Z", durationMinutes: 720, transportAvailableAt: null }, confidence: "HIGH" },
    { fact_key: "standby", subject_type: "EVENT", subject_id: "standby", value: { durationMinutes: 180, regime: "REGULAR", location: "CGH", called: "UNKNOWN" }, confidence: "HIGH" },
  ], "2026-08-01", { documentContractualBase: "CGH", profileContractualBase: "CGH", virtualBase: "CGH", virtualBaseActive: "ACTIVE" });
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "LAW_MINIMUM_REST_AFTER_DUTY")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_CONTRACTUAL_BASE_CLASSIFICATION")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_DIFFERENT_AIRPORT_PRE_REST_INCREMENT")?.factsSnapshot.requiredIncrementMinutes, 60);
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_DIFFERENT_AIRPORT_BOTH_REST_INCREMENT")?.status, "PASS");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "LAW_REST_TRANSPORT_DELAY")?.status, "UNKNOWN");
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION")?.status, "UNKNOWN");
});

test("uses concrete interval subjects and the import subject for global evaluations", () => {
  const importId = "d72b8df6-e10c-40d4-9f78-52d73a966df9";
  const result = buildFlightRuleEvaluations("PLANNED", [
    { fact_key: "ground_interval", subject_type: "GROUND_INTERVAL", subject_id: "ground-a", value: { minutes: 30, classification: "DAY" }, confidence: "HIGH" },
    { fact_key: "ground_interval", subject_type: "GROUND_INTERVAL", subject_id: "ground-b", value: { minutes: 30, classification: "DAY" }, confidence: "HIGH" },
    { fact_key: "rest_interval", subject_type: "REST", subject_id: "rest-a", value: { durationMinutes: 720 }, confidence: "HIGH" },
  ], undefined, undefined, importId);

  const groundSubjects = result
    .filter((evaluation) => evaluation.ruleKey === "GOL_GROUND_TIME_BETWEEN_LEGS")
    .map((evaluation) => evaluation.subjectId);
  assert.deepEqual(groundSubjects, ["ground-a", "ground-b"]);
  assert.equal(result.find((evaluation) => evaluation.ruleKey === "LAW_MINIMUM_REST_AFTER_DUTY")?.subjectId, "rest-a");
  assert.ok(result.every((evaluation) => evaluation.subjectId !== null));
  assert.ok(result.some((evaluation) => evaluation.subjectType === "IMPORT" && evaluation.subjectId === importId));
});
