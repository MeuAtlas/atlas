import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCounterpartyFingerprint,
  fingerprintsMatch,
  hashFinancialIdentifier,
  normalizeBrazilianTaxNumber,
  normalizeFinancialName,
  pixCounterpartyNameFromDescription,
} from "./financial-counterparty";

test("normaliza nomes e documentos sem armazenar pontuação", () => {
  assert.equal(normalizeFinancialName("  Pousada BSB — Brasília  "), "pousada bsb brasilia");
  assert.equal(normalizeBrazilianTaxNumber("00.757.565/0001-59"), "00757565000159");
});

test("hash financeiro é estável e não contém o identificador original", () => {
  const value = "00757565000159";
  const first = hashFinancialIdentifier(value);
  assert.equal(first, hashFinancialIdentifier(value));
  assert.ok(first);
  assert.doesNotMatch(first ?? "", new RegExp(value));
});

test("extrai contraparte Pix explícita sem criar vínculo automático", () => {
  assert.equal(
    pixCounterpartyNameFromDescription("PIX ENVIADO PARA VIRNA SILVA"),
    "VIRNA SILVA",
  );
});

test("fingerprints iguais reconhecem somente identificadores fortes equivalentes", () => {
  const common = {
    description: "PIX ENVIADO PARA VIRNA SILVA",
    provider: "pluggy",
    direction: "outflow" as const,
  };
  const first = extractCounterpartyFingerprint({
    ...common,
    providerMetadata: { counterparty: { pixKey: "virna@example.com" } },
  });
  const second = extractCounterpartyFingerprint({
    ...common,
    providerMetadata: { counterparty: { pixKey: "virna@example.com" } },
  });
  assert.equal(fingerprintsMatch(first, second), true);
});
