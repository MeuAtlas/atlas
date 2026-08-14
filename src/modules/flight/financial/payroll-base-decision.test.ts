import assert from "node:assert/strict";
import test from "node:test";
import { decidePayrollBase } from "./payroll-base-decision";

test("selects planned gross even when executed flight time is greater", () => {
  const result = decidePayrollBase({ plannedGrossCents: 2418040, executedGrossCents: 2335669 });
  assert.equal(result.selectedScenario, "PLANNED");
  assert.equal(result.grossDifferenceCents, -82371);
});

test("selects the scenario with the greater gross by one cent", () => {
  const result = decidePayrollBase({ plannedGrossCents: 2335669, executedGrossCents: 2335670 });
  assert.equal(result.selectedScenario, "EXECUTED");
  assert.equal(result.grossDifferenceCents, 1);
});

test("does not use another metric as a tie breaker", () => {
  const result = decidePayrollBase({ plannedGrossCents: 2300000, executedGrossCents: 2300000 });
  assert.equal(result.selectedScenario, "TIE");
  assert.equal(result.reason, "EQUAL_GROSS_PAY");
});

test("does not turn an unavailable scenario into zero", () => {
  const result = decidePayrollBase({ plannedGrossCents: null, executedGrossCents: 2300000 });
  assert.equal(result.selectedScenario, "UNAVAILABLE");
  assert.equal(result.grossDifferenceCents, null);
});
