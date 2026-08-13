import assert from "node:assert/strict";
import test from "node:test";
import { resolveEconomicParameter } from "./financial-economic-resolution";

const parameter = (overrides: Partial<Parameters<typeof resolveEconomicParameter>[0][number]> = {}) => ({ id: "p", parameter_key: "SALARY_FLOOR", role: "COPILOT", value_cents: 10000, effective_from: "2025-12-01", effective_to: null, lifecycle: "ACTIVE", source_instrument_id: "act", source_clause_reference: "floor", seniority_applicable: true, ...overrides });

test("activates an ACT floor only when the documented effective interval covers the closure", () => {
  const result = resolveEconomicParameter([parameter()], "SALARY_FLOOR", "COPILOT", "2026-08-01");
  assert.equal(result.applicable, true);
  assert.equal(result.parameter?.value_cents, 10000);
});

test("keeps a known hourly value unresolved without an effective date", () => {
  const result = resolveEconomicParameter([parameter({ parameter_key: "FLIGHT_HOUR_TOTAL", effective_from: null, lifecycle: "REVIEW_REQUIRED" })], "FLIGHT_HOUR_TOTAL", "COPILOT", "2026-08-01");
  assert.equal(result.valueKnown, true);
  assert.equal(result.applicable, false);
  assert.equal(result.blocker, "WAITING_DOCUMENT_EFFECTIVE_DATE");
});
