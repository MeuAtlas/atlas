import assert from "node:assert/strict";
import test from "node:test";
import {
  localDateInTimeZone,
  normalizeProviderTransactionDate,
} from "./provider-transaction-date";

test("converte UTC uma única vez para America/Sao_Paulo", () => {
  const value = normalizeProviderTransactionDate({
    date: "2026-07-04T02:30:00.000Z",
  });
  assert.equal(value.providerDate, "2026-07-04T02:30:00.000Z");
  assert.equal(value.providerPostedAt, "2026-07-04T02:30:00.000Z");
  assert.equal(value.localDate, "2026-07-03");
  assert.equal(value.dateSource, "provider_posted");
});

test("meia-noite UTC, sábado e domingo não são movidos para segunda", () => {
  assert.equal(localDateInTimeZone("2026-07-05T03:00:00.000Z"), "2026-07-05");
  assert.equal(localDateInTimeZone("2026-07-04T12:00:00.000Z"), "2026-07-04");
  assert.equal(localDateInTimeZone("2026-07-06T00:00:00.000Z"), "2026-07-05");
});

test("data efetiva estruturada é preservada separadamente", () => {
  const value = normalizeProviderTransactionDate({
    date: "2026-07-04T12:00:00.000Z",
    effectiveDate: "2026-07-06T12:00:00.000Z",
  });
  assert.equal(value.providerPostedAt, "2026-07-04T12:00:00.000Z");
  assert.equal(value.effectiveAt, "2026-07-06T12:00:00.000Z");
  assert.equal(value.bankPostedAt, "2026-07-06T12:00:00.000Z");
  assert.equal(value.localDate, "2026-07-06");
  assert.equal(value.dateSource, "provider_effective");
});

