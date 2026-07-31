import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("interface não oferece entidades nem vínculos automáticos", () => {
  const movements = read("src/components/finance/movements-browser.tsx");
  const page = read("src/app/financeiro/movimentacoes/page.tsx");
  const removedRoute = read(
    "src/app/financeiro/movimentacoes/regras/page.tsx",
  );
  assert.doesNotMatch(movements, /Vincular à entidade|Regras automáticas/);
  assert.doesNotMatch(page, /getFinancialEntitiesData|transaction_entities/);
  assert.match(removedRoute, /redirect\("\/financeiro\/movimentacoes"\)/);
});

test("associação de pessoa é sempre manual e limitada ao movimento atual", () => {
  const actions = read("src/modules/finance/movement-person-actions.ts");
  const movements = read("src/components/finance/movements-browser.tsx");
  assert.match(actions, /source: "manual"/);
  assert.match(actions, /association_scope: "current"/);
  assert.doesNotMatch(actions, /financial_entities|transaction_entities/);
  assert.doesNotMatch(movements, /Esta e outras semelhantes/);
});

test("migration apaga entidades e automações sem apagar movimentações", () => {
  const migration = read(
    "supabase/migrations/202607300062_remove_financial_entities_and_automatic_links.sql",
  );
  assert.match(migration, /drop table if exists public\.financial_entities/);
  assert.match(migration, /drop table if exists public\.transaction_entities/);
  assert.match(migration, /delete from public\.person_counterparties/);
  assert.match(migration, /delete from public\.commitment_match_rules/);
  assert.match(migration, /auto_match_enabled = false/);
  assert.doesNotMatch(migration, /delete from public\.financial_transactions/);
  assert.doesNotMatch(migration, /delete from public\.card_purchases/);
});
