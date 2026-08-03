import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync(
  "src/modules/finance/movement-person-actions.ts",
  "utf8",
);
const browser = readFileSync(
  "src/components/finance/movements-browser.tsx",
  "utf8",
);
const styles = readFileSync("src/app/globals.css", "utf8");
const movementsPage = readFileSync(
  "src/app/financeiro/movimentacoes/page.tsx",
  "utf8",
);

test("pessoa é vinculada somente à movimentação escolhida", () => {
  assert.match(actions, /association_scope: "current"/);
  assert.match(actions, /source: "manual"/);
  assert.doesNotMatch(actions, /financial_entities|transaction_entities/);
  assert.doesNotMatch(browser, /Esta e outras semelhantes/);
  assert.match(browser, /somente a esta movimentação/);
});

test("recorrência permanece separada da identificação manual da pessoa", () => {
  assert.match(browser, /Nenhuma regra ou vínculo automático será criado/);
  assert.match(browser, /Prever novamente/);
  assert.match(browser, /Vincular a um compromisso ou parcela/);
});

test("compromisso aceita pagamentos adicionais e memoriza o destino", () => {
  assert.doesNotMatch(
    movementsPage,
    /financial_commitment_occurrences[\s\S]{0,900}\.is\("linked_transaction_id", null\)/,
  );
  assert.match(movementsPage, /\.gte\("competence_month"/);
  assert.match(browser, /memoriza o identificador seguro do/);
  assert.match(browser, /somados até quitar o/);
});

test("painel da pessoa bloqueia estouro horizontal no modal e no gráfico", () => {
  assert.match(styles, /\.person-dashboard-body\{[^}]*overflow-x:hidden/);
  assert.match(
    styles,
    /\.person-monthly-trend\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(0,1fr\)\)/,
  );
  assert.doesNotMatch(
    styles,
    /\.person-monthly-trend\{[^}]*overflow-x:auto/,
  );
});
