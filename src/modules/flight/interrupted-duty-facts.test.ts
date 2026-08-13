import assert from "node:assert/strict";
import test from "node:test";
import { deriveInterruptedDutyCount168h, deriveInterruptedDutyFact } from "./interrupted-duty-facts";

const base = { dutyId: "duty", dutyEndAt: "2026-08-10T12:00:00.000Z", contractualBase: "BSB", gaps: [{ startAt: "2026-08-10T07:00:00.000Z", endAt: "2026-08-10T08:00:00.000Z", airport: "BSB", timezone: "America/Sao_Paulo" }] };

test("only detects one structurally relevant internal interval", () => {
  assert.equal(deriveInterruptedDutyFact(base).interruptedDutyDetected, "FALSE");
  const fact = deriveInterruptedDutyFact({ ...base, gaps: [{ startAt: "2026-08-10T02:00:00.000Z", endAt: "2026-08-10T06:00:00.000Z", airport: "BSB", timezone: "America/Sao_Paulo" }] });
  assert.equal(fact.interruptedDutyDetected, "TRUE");
  assert.equal(fact.interruptionMinutes, 240);
  assert.equal(fact.postInterruptionDutyMinutes, 360);
});

test("uses the factual local timezone for the 00:00 to 06:00 window", () => {
  const night = deriveInterruptedDutyFact({ ...base, gaps: [{ startAt: "2026-08-10T01:00:00.000Z", endAt: "2026-08-10T05:00:00.000Z", airport: "BSB", timezone: "America/Sao_Paulo" }] });
  const day = deriveInterruptedDutyFact({ ...base, gaps: [{ startAt: "2026-08-10T10:00:00.000Z", endAt: "2026-08-10T14:00:00.000Z", airport: "BSB", timezone: "America/Sao_Paulo" }] });
  assert.equal(night.interruptionTouches0000To0600, "TRUE");
  assert.equal(day.interruptionTouches0000To0600, "FALSE");
  assert.equal(deriveInterruptedDutyFact({ ...base, gaps: [{ startAt: "2026-08-10T01:00:00.000Z", endAt: "2026-08-10T05:00:00.000Z", airport: "BSB", timezone: null }] }).interruptionTouches0000To0600, "UNKNOWN");
});

test("does not infer accommodation and preserves 168 hour history completeness", () => {
  const fact = deriveInterruptedDutyFact({ ...base, gaps: [{ startAt: "2026-08-10T02:00:00.000Z", endAt: "2026-08-10T06:00:00.000Z", airport: "CGH", timezone: "America/Sao_Paulo" }] });
  assert.equal(fact.accommodationConfirmed, "UNKNOWN");
  assert.equal(fact.dutyOutsideContractualBase, "TRUE");
  const complete = deriveInterruptedDutyCount168h("b", "2026-08-10T12:00:00.000Z", "TRUE", [{ dutyId: "a", interruptionEndAt: "2026-08-08T12:00:00.000Z" }, { dutyId: "b", interruptionEndAt: "2026-08-10T12:00:00.000Z" }], "2026-08-01T00:00:00.000Z");
  assert.deepEqual(complete.value, 2);
  assert.equal(complete.historyComplete168h, true);
  assert.equal(deriveInterruptedDutyCount168h("b", "2026-08-10T12:00:00.000Z", "TRUE", [], "2026-08-09T00:00:00.000Z").value, "UNKNOWN");
});
