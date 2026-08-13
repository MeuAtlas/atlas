import assert from "node:assert/strict";
import test from "node:test";
import { deriveFinancialUnits, rationalMinutes } from "./financial-units";

test("creates operating, deadhead, standby and reserve units without mixing semantics", () => {
  const units = deriveFinancialUnits({ importId: "import", legs: [{ id: "op", legType: "OPERATING", durationMinutes: 60 }, { id: "dh", legType: "DEADHEAD", durationMinutes: 60 }], standby: [{ id: "standby", durationMinutes: 180 }], reserve: [{ id: "reserve", durationMinutes: 180 }], deadheadPolicy: "SAME_AS_OPERATING_FOR_REMUNERATION" });
  assert.equal(units.find((unit) => unit.subjectId === "op")?.remunerableSeconds, 3600);
  assert.equal(units.find((unit) => unit.subjectId === "dh")?.remunerableSeconds, 3600);
  assert.equal(units.find((unit) => unit.subjectId === "dh")?.normalOperatingCandidateSeconds, 0);
  assert.deepEqual(rationalMinutes(units.find((unit) => unit.subjectId === "standby")!.guaranteeNumeratorSeconds, 3), { numeratorSeconds: 10800, denominator: 3 });
  assert.equal(units.find((unit) => unit.subjectId === "reserve")?.remunerableSeconds, 10800);
});

test("preserves one-third standby exactly and produces stable idempotent identifiers", () => {
  const input = { importId: "import", legs: [], standby: [{ id: "fraction", durationMinutes: 100 }], reserve: [], deadheadPolicy: "SAME_AS_OPERATING_FOR_REMUNERATION" as const };
  const first = deriveFinancialUnits(input); const second = deriveFinancialUnits(input);
  assert.equal(first[0].guaranteeNumeratorSeconds, 6000);
  assert.equal(first[0].guaranteeDenominator, 3);
  assert.deepEqual(first.map((item) => item.id), second.map((item) => item.id));
  assert.equal(first.find((item) => item.financialFactType === "PRELIMINARY_GUARANTEE_ACCUMULATOR")?.specialTimePendingSeconds, 0);
});
