import assert from "node:assert/strict";
import test from "node:test";
import { reconcileFlightTime } from "./processing-reconciliation";

test("aceita reconciliação dentro da tolerância", () => {
  assert.equal(reconcileFlightTime(3802, 3797).status, "VALID");
  assert.equal(reconcileFlightTime(3802, 3800).status, "VALID");
  assert.equal(reconcileFlightTime(3802, 3802).status, "VALID");
});

test("marca processamento incompleto e preserva horas processadas e faltantes", () => {
  assert.deepEqual(reconcileFlightTime(3802, 1877), {
    status: "INCOMPLETE",
    documentedMinutes: 3802,
    processedMinutes: 1877,
    differenceMinutes: -1925,
    missingMinutes: 1925,
    thresholdMinutes: 5,
  });
});

test("não declara sucesso sem total documental ou processado", () => {
  assert.equal(reconcileFlightTime(null, 1877).status, "UNKNOWN");
  assert.equal(reconcileFlightTime(3802, null).status, "UNKNOWN");
});
