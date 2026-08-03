import assert from "node:assert/strict";
import test from "node:test";
import {
  openInvoiceCacheTag,
  openInvoiceDifference,
  resolveOpenInvoiceTotal,
  resolvedOpenInvoiceSourceLabel,
} from "./open-card-invoice";

test("estimativa maior supera o valor manual da fatura aberta", () => {
  const resolved = resolveOpenInvoiceTotal({
    confirmedOpenTotal: 7082.45,
    confirmationTotal: 7000,
    providerInvoiceTotal: 6900,
    providerReliable: false,
    manualInvoiceTotal: 6800,
    calculatedTotal: 7111.37,
    lastReliableTotal: 6700,
  });
  assert.equal(resolved.amount, 7111.37);
  assert.equal(resolved.source, "calculated");
});

test("valor manual maior permanece acima da estimativa sincronizada", () => {
  const resolved = resolveOpenInvoiceTotal({
    confirmationTotal: 7397.25,
    calculatedTotal: 6942.14,
    calculatedReliable: true,
  });
  assert.equal(resolved.amount, 7397.25);
  assert.equal(resolved.source, "confirmed_open_total");
});

test("Bill oficial do mesmo ciclo continua sendo a fonte principal", () => {
  const resolved = resolveOpenInvoiceTotal({
    confirmedOpenTotal: 7397.25,
    providerInvoiceTotal: 7412.9,
    providerReliable: true,
    calculatedTotal: 7500,
  });
  assert.equal(resolved.amount, 7412.9);
  assert.equal(resolved.source, "provider_bill");
});

test("Bill só é promovida quando confiável e fallback mantém último valor", () => {
  assert.equal(resolveOpenInvoiceTotal({
    providerInvoiceTotal: 7100,
    providerReliable: false,
    lastReliableTotal: 7082.45,
  }).source, "last_reliable");
  assert.equal(resolveOpenInvoiceTotal({
    providerInvoiceTotal: 7100,
    providerReliable: true,
    lastReliableTotal: 7082.45,
  }).source, "provider_bill");
});

test("diferença e tag usam centavos, workspace e cycleId", () => {
  assert.equal(openInvoiceDifference(7082.45, 6942.14), 140.31);
  assert.equal(
    openInvoiceCacheTag("workspace", "cycle"),
    "finance:card-cycle-details:workspace:cycle",
  );
});

test("último valor confiável precede uma nova estimativa sem snapshot", () => {
  const resolved = resolveOpenInvoiceTotal({
    calculatedTotal: 6942.14,
    calculatedReliable: true,
    lastReliableTotal: 7082.45,
  });
  assert.equal(resolved.amount, 7082.45);
  assert.equal(resolved.source, "last_reliable");
  assert.equal(resolvedOpenInvoiceSourceLabel({
    source: "last_reliable",
    providerOrigin: true,
  }), "Pluggy — último valor confiável");
});

test("último valor confiável é fallback sem estimativa atual", () => {
  const resolved = resolveOpenInvoiceTotal({
    calculatedTotal: null,
    lastReliableTotal: 7082.45,
  });
  assert.equal(resolved.amount, 7082.45);
  assert.equal(resolved.source, "last_reliable");
});

test("fonte confirmada identifica Santander sem acoplar a prioridade", () => {
  assert.equal(resolvedOpenInvoiceSourceLabel({
    source: "confirmed_open_total",
    institutionName: "Banco Santander",
  }), "Confirmada no Santander");
});
