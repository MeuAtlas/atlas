import assert from "node:assert/strict";
import test from "node:test";
import { deriveAugmentedCrewFacts } from "./augmented-crew-facts";

test("preserves explicit crew and inflight-rest facts", () => {
  const simple = deriveAugmentedCrewFacts(3, { crewComposition: "SIMPLE", inflightRestClass: "CLASS_3", plannedInflightRestMinutes: 120, performsFinalLanding: true });
  assert.equal(simple.crewComposition, "SIMPLE");
  assert.equal(simple.inflightRestClass, "CLASS_3");
  assert.equal(simple.plannedInflightRestMinutes, 120);
  assert.equal(simple.actualInflightRestMinutes, "UNKNOWN");
  assert.equal(simple.performsFinalLanding, "TRUE");
  assert.equal(simple.augmentedCrewEligibleFactsComplete, "TRUE");
  assert.equal(deriveAugmentedCrewFacts(3, { crewComposition: "COMPOSED" }).crewComposition, "COMPOSED");
});

test("does not infer crew composition, rest, final landing, or deadhead legs", () => {
  const unknown = deriveAugmentedCrewFacts(3);
  assert.equal(unknown.crewComposition, "UNKNOWN");
  assert.equal(unknown.inflightRestClass, "UNKNOWN");
  assert.equal(unknown.performsFinalLanding, "UNKNOWN");
  assert.equal(unknown.augmentedCrewEligibleFactsComplete, "FALSE");
  assert.equal(deriveAugmentedCrewFacts(3, { operatingCrewCount: 2, reliefCrewCount: 1 }).operatingLegCount, 3);
});
