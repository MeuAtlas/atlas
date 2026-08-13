import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const switcher = readFileSync("src/components/atlas/module-switcher.tsx", "utf8");
const financeShell = readFileSync("src/components/finance/finance-shell.tsx", "utf8");
const flightShell = readFileSync("src/components/flight/flight-shell.tsx", "utf8");

test("seletor global deriva o módulo ativo do pathname e suporta subrotas", () => {
  assert.match(switcher, /usePathname\(\)/);
  assert.match(switcher, /pathname === href \|\| pathname\.startsWith\(`\$\{href\}\/`\)/);
  assert.match(switcher, /module\.slug === current\?\.slug/);
  assert.doesNotMatch(switcher, /currentSlug/);
});

test("Financeiro e Escala compartilham o mesmo header sem compartilhar a subnavegação", () => {
  assert.match(financeShell, /AtlasGlobalHeader/);
  assert.match(financeShell, /<FinanceTabs/);
  assert.match(flightShell, /AtlasGlobalHeader/);
  assert.doesNotMatch(flightShell, /FinanceTabs|finance-navigation/);
});
