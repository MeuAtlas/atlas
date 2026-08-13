import assert from "node:assert/strict";
import test from "node:test";
import { applyRuleManifest, validateRuleManifest } from "./legal-rules";

const validManifest = {
  instrument: { instrumentType: "ACT", instrumentCode: "ACT-TEST-2026", version: 1, title: "ACT teste 2026", effectiveFrom: "2026-01-01" },
  clauses: [{ clauseKey: "TEST_CLAUSE", clauseNumber: "1", sourceText: "Texto documental de teste." }],
  rules: [{ ruleKey: "TEST_RULE", ruleVersion: 1, title: "Regra de teste", category: "REST", effectiveFrom: "2026-01-01", status: "DRAFT", sources: [{ clauseKey: "TEST_CLAUSE", sourceRole: "PRIMARY" }] }],
  ruleset: { rulesetCode: "TEST-2026", version: 1, name: "Ruleset teste", effectiveFrom: "2026-01-01", ruleReferences: [{ ruleKey: "TEST_RULE", ruleVersion: 1, sequence: 1 }] },
};

test("validateRuleManifest produces a deterministic dry run without persistence", () => {
  const result = validateRuleManifest(validManifest);
  assert.equal(result.valid, true);
  assert.equal(result.newInstruments, 1);
  assert.equal(result.newClauses, 1);
  assert.equal(result.newRules, 1);
});

test("validateRuleManifest rejects missing sources and invalid dates", () => {
  const result = validateRuleManifest({ ...validManifest, clauses: [], rules: [{ ...validManifest.rules[0], effectiveTo: "2025-12-31" }] });
  assert.equal(result.valid, false);
  assert.deepEqual(result.missingSources, ["TEST_RULE v1: TEST_CLAUSE"]);
  assert.match(result.conflicts.join(" "), /vigência/);
});

test("validateRuleManifest detects ACTIVE overlap only for the same scope", () => {
  const activeRule = { ...validManifest.rules[0], status: "ACTIVE" as const, scope: { role: "FIRST_OFFICER" } };
  const existing = [{ ruleKey: "TEST_RULE", ruleVersion: 1, effectiveFrom: "2026-01-01", effectiveTo: null, status: "ACTIVE" as const, scope: { role: "FIRST_OFFICER" } }];
  const conflict = validateRuleManifest({ ...validManifest, rules: [{ ...activeRule, ruleVersion: 2 }] }, existing);
  assert.equal(conflict.valid, false);
  assert.equal(conflict.overlappingRules.length, 1);
  const distinctScope = validateRuleManifest({ ...validManifest, rules: [{ ...activeRule, ruleVersion: 2, scope: { role: "COMMANDER" } }] }, existing);
  assert.equal(distinctScope.valid, true);
});

test("applyRuleManifest never persists invalid manifests", async () => {
  let persisted = false;
  const result = await applyRuleManifest({ ...validManifest, rules: [{ ...validManifest.rules[0], sources: [] }] }, async () => { persisted = true; });
  assert.equal(result.valid, false);
  assert.equal(persisted, false);
});

test("validateRuleManifest rejects duplicate versions and missing ruleset references", () => {
  const duplicate = validateRuleManifest({ ...validManifest, rules: [validManifest.rules[0], { ...validManifest.rules[0], title: "Outra regra" }] });
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.conflicts.join(" "), /Versão duplicada/);
  const missingReference = validateRuleManifest({ ...validManifest, ruleset: { ...validManifest.ruleset, ruleReferences: [{ ruleKey: "MISSING_RULE", ruleVersion: 1, sequence: 1 }] } });
  assert.equal(missingReference.valid, false);
  assert.match(missingReference.conflicts.join(" "), /regra inexistente/);
});
