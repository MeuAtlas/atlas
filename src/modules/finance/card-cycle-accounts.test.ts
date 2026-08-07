import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCardCycleAccountIds,
  resolveCycleCompetenceMonth,
  resolveOpenProjectionCardAccountIds,
} from "./card-cycle-accounts";

test("mantém contas Mastercard e Visa independentes na mesma conexão", () => {
  const result = resolveCardCycleAccountIds("mastercard", [
    {
      id: "mastercard",
      external_id: "provider-master",
      bank_connection_id: "santander",
      status: "active",
      credit_card_instruments: [
        { id: "physical", last_four_digits: "5718" },
        { id: "additional", last_four_digits: "6579" },
        { id: "virtual", last_four_digits: "5991" },
      ],
    },
    {
      id: "visa-active",
      external_id: "provider-visa",
      bank_connection_id: "santander",
      status: "active",
    },
    {
      id: "archived-visa",
      external_id: "provider-archived",
      bank_connection_id: "santander",
      status: "archived",
    },
    {
      id: "other-item",
      external_id: "provider-other",
      bank_connection_id: "other",
      status: "active",
    },
  ]);
  assert.deepEqual(result.cardIds, ["mastercard"]);
  assert.deepEqual(result.accountIds, ["provider-master"]);
  assert.deepEqual(result.instrumentIds, ["physical", "additional", "virtual"]);
  assert.deepEqual(result.instrumentLastFours, ["5718", "6579", "5991"]);
  assert.equal(result.resolutionSource, "primary_card");
});

test("projeção aberta mantém Visa e Mastercard em faturas independentes", () => {
  const result = resolveOpenProjectionCardAccountIds("visa", [
    {
      id: "visa",
      external_id: "provider-visa",
      bank_connection_id: "santander",
      status: "active",
    },
    {
      id: "mastercard",
      external_id: "provider-master",
      bank_connection_id: "santander",
      status: "active",
      credit_card_instruments: [
        { id: "master-5718", last_four_digits: "5718" },
      ],
    },
    {
      id: "archived",
      bank_connection_id: "santander",
      status: "archived",
    },
    {
      id: "other-connection",
      external_id: "provider-other",
      bank_connection_id: "other",
      status: "active",
    },
  ]);

  assert.deepEqual(result.cardIds, ["visa"]);
  assert.deepEqual(result.accountIds, ["provider-visa"]);
  assert.deepEqual(result.instrumentIds, []);
  assert.equal(result.resolutionSource, "primary_card");
});

test("competência usa vencimento e recua para fechamento/referência", () => {
  assert.equal(resolveCycleCompetenceMonth({
    due_date: "2026-08-10",
    closing_date: "2026-08-03",
    reference_month: "2026-07-01",
  }), "2026-08-01");
  assert.equal(resolveCycleCompetenceMonth({
    due_date: null,
    closing_date: "2026-08-03",
    reference_month: "2026-07-01",
  }), "2026-08-01");
});
