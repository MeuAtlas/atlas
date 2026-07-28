import assert from "node:assert/strict";
import test from "node:test";
import {
  openInvoiceCacheTag,
  openInvoiceDifference,
  resolveOpenInvoiceTotal,
  resolvedOpenInvoiceSourceLabel,
} from "./open-card-invoice";

test("confirmed_open_total tem prioridade sobre todos os aliases", () => {
  const resolved = resolveOpenInvoiceTotal({
    confirmedOpenTotal: 7082.45,
    confirmationTotal: 7000,
    providerInvoiceTotal: 6900,
    providerReliable: true,
    manualInvoiceTotal: 6800,
    calculatedTotal: 6942.14,
    lastReliableTotal: 6700,
  });
  assert.equal(resolved.amount, 7082.45);
  assert.equal(resolved.source, "confirmed_open_total");
});

test("snapshot manual precede Bill e detalhes parciais", () => {
  const resolved = resolveOpenInvoiceTotal({
    confirmationTotal: 7082.45,
    providerInvoiceTotal: 7100,
    providerReliable: true,
    calculatedTotal: 6942.14,
    calculatedReliable: false,
  });
  assert.equal(resolved.amount, 7082.45);
  assert.equal(resolved.source, "confirmed_open_total");
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

test("último valor confiável da Pluggy precede detalhe parcial calculado", () => {
  const resolved = resolveOpenInvoiceTotal({
    calculatedTotal: 6942.14,
    calculatedReliable: true,
    lastReliableTotal: 7082.45,
  });
  assert.equal(resolved.amount, 7082.45);
  assert.equal(resolved.source, "last_reliable");
  assert.equal(resolvedOpenInvoiceSourceLabel({
    source: resolved.source,
    providerOrigin: true,
  }), "Pluggy — último valor confiável");
});

test("fonte confirmada identifica Santander sem acoplar a prioridade", () => {
  assert.equal(resolvedOpenInvoiceSourceLabel({
    source: "confirmed_open_total",
    institutionName: "Banco Santander",
  }), "Confirmada no Santander");
});
