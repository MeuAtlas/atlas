import assert from "node:assert/strict";
import test from "node:test";
import { formatScheduleCompetence, resolveScheduleCompetence, shiftScheduleCompetence } from "./schedule-competence";

test("resolves a valid monthly competence and rejects invalid URL input", () => {
  assert.deepEqual(resolveScheduleCompetence("2026-06", { year: 2026, month: 8 }), { year: 2026, month: 6 });
  assert.deepEqual(resolveScheduleCompetence("2026-99", { year: 2026, month: 8 }), { year: 2026, month: 8 });
});

test("moves across month and year boundaries", () => {
  assert.deepEqual(shiftScheduleCompetence({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftScheduleCompetence({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.equal(formatScheduleCompetence({ year: 2026, month: 6 }), "2026-06");
});
