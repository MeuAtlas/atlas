import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const modal = readFileSync(
  join(root, "src/components/ui/atlas-modal.tsx"),
  "utf8",
);
const commitments = readFileSync(
  join(root, "src/components/finance/commitments/commitments-workspace.tsx"),
  "utf8",
);
const personForm = readFileSync(
  join(root, "src/components/finance/commitments/person-form.tsx"),
  "utf8",
);
const personDetails = readFileSync(
  join(root, "src/components/finance/commitments/person-details.tsx"),
  "utf8",
);
const relationsMigration = readFileSync(
  join(
    root,
    "supabase/migrations/202607280041_expand_financial_people_relations.sql",
  ),
  "utf8",
);

test("AtlasModal expõe estrutura reutilizável e três tamanhos", () => {
  for (const exportName of [
    "AtlasModal",
    "AtlasModalHeader",
    "AtlasModalBody",
    "AtlasModalFooter",
    "AtlasModalClose",
  ]) {
    assert.match(modal, new RegExp(`export function ${exportName}`));
  }
  assert.match(modal, /"small" \| "medium" \| "large"/);
  assert.match(modal, /createPortal/);
});

test("AtlasModal implementa o contrato básico de acessibilidade", () => {
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /event\.key === "Escape"/);
  assert.match(modal, /event\.key !== "Tab"/);
  assert.match(modal, /opener\?\.focus\(\)/);
  assert.match(modal, /document\.body\.style\.overflow = "hidden"/);
});

test("Compromissos usa modais para criar, editar, detalhar e confirmar", () => {
  for (const state of [
    "commitment-create",
    "commitment-edit",
    "commitment-details",
    "person-create",
    "person-edit",
    "person-details",
    "confirm",
  ]) {
    assert.match(commitments, new RegExp(state));
  }
  assert.doesNotMatch(commitments, /commitment-drawer-backdrop/);
  assert.match(personDetails, /Dependente financeiro/);
  assert.doesNotMatch(personForm, /name="color_key"/);
});

test("relações simplificadas são persistidas sem remover valores legados", () => {
  for (const relation of [
    "daughter",
    "son",
    "wife",
    "husband",
    "mother",
    "father",
    "child",
    "spouse",
    "parent",
  ]) {
    assert.match(relationsMigration, new RegExp(`'${relation}'`));
  }
});
