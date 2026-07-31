import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveMonthlyCommitmentTotals } from "./commitments";

test("compromisso sem pessoa é próprio e não é duplicado", () => {
  const totals = resolveMonthlyCommitmentTotals([
    {
      occurrenceId: "occurrence",
      commitmentId: "internet",
      amountCents: 10_000,
      status: "paid",
      commitmentType: "recurring",
      people: [],
    },
    {
      occurrenceId: "occurrence",
      commitmentId: "internet",
      amountCents: 10_000,
      status: "paid",
      commitmentType: "recurring",
      people: [],
    },
  ]);
  assert.equal(totals.realized, 10_000);
  assert.equal(totals.totalCommitted, 10_000);
  assert.equal(totals.ownCommitments, 10_000);
  assert.deepEqual(totals.byPerson, {});
});

test("resumo por pessoa recebe somente a parcela alocada", () => {
  const totals = resolveMonthlyCommitmentTotals([{
    occurrenceId: "school-july",
    commitmentId: "school",
    amountCents: 168_000,
    status: "pending",
    commitmentType: "recurring",
    people: [{
      personId: "anna",
      allocationType: "full",
      allocationValue: 100,
      isPrimary: true,
    }],
  }]);
  assert.equal(totals.pending, 168_000);
  assert.equal(totals.byPerson.anna, 168_000);
  assert.equal(totals.ownCommitments, 0);
});

test("interface usa gastos por pessoa e não oferece self", () => {
  const component = readFileSync(path.join(
    process.cwd(),
    "src/components/finance/commitments/commitments-workspace.tsx",
  ), "utf8");
  const actions = readFileSync(path.join(
    process.cwd(),
    "src/modules/finance/commitments-actions.ts",
  ), "utf8");
  assert.match(component, /Gastos por pessoa/);
  assert.match(component, /Dependentes/);
  assert.doesNotMatch(component, /self: "Eu"/);
  assert.doesNotMatch(actions, /"self", "daughter"/);
});
