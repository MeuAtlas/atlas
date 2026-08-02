import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/modules/finance/queries.ts"),
  "utf8",
);
const overviewSource = readFileSync(
  join(process.cwd(), "src/modules/finance/finance-overview-query.ts"),
  "utf8",
);

test("overview consulta competência, classificação e alvos necessários", () => {
  for (const field of [
    "competence_date",
    "transaction_role",
    "source_type",
    "cash_flow_kind",
    "payment_source",
    "loan_id",
    "invoice_id",
    "transfer_group_id",
    "external_id",
  ]) {
    assert.match(source, new RegExp(field));
  }
});

test("overview limita histórico pelo início inclusivo e mantém fallback de compra", () => {
  assert.match(source, /\.gte\("competence_date",historyStart\)/);
  assert.match(
    source,
    /competence_date\.gte\.\$\{historyStart\}.*competence_date\.is\.null.*purchase_date\.gte/,
  );
});

test("visão geral, projeção e detalhe usam a mesma seleção compatível de compras", () => {
  assert.match(source, /export const CARD_PURCHASE_SELECT/);
  assert.equal(
    source.match(/from\("card_purchases"\)\.select\(CARD_PURCHASE_SELECT\)/g)
      ?.length,
    3,
  );
  const selection = source.slice(
    source.indexOf("export const CARD_PURCHASE_SELECT"),
    source.indexOf("export async function getCardInvoiceHistory"),
  );
  assert.doesNotMatch(selection, /realized_at/);
});

test("queries separam owner privado de workspace compartilhado", () => {
  assert.match(source, /\.eq\("owner_id",userId\)\.is\("workspace_id",null\)/);
  assert.match(
    source,
    /\.eq\("workspace_id",workspaceId\)\.eq\("visibility","workspace"\)/,
  );
});

test("workspace pessoal traduz o escopo para os dados bancários privados", () => {
  assert.match(
    overviewSource,
    /activeWorkspace\.includeOwnerPrivateData[\s\S]*\? null[\s\S]*: activeWorkspace\.workspaceId/,
  );
  assert.match(
    overviewSource,
    /getFinanceOverviewData[\s\S]*workspaceId: financialDataWorkspaceId/,
  );
  assert.match(
    overviewSource,
    /getBankAccountMonthlyTransactions[\s\S]*workspaceId: financialDataWorkspaceId/,
  );
});

test("movimentação da conta é filtrada por conta, mês e status bancário", () => {
  assert.match(source, /getBankAccountMonthlyTransactions/);
  assert.match(
    source,
    /account_id\.eq\.\$\{accountId\},destination_account_id\.eq\.\$\{accountId\}/,
  );
  assert.match(source, /realized_at\.gte\.\$\{period\.startInstant\}/);
  assert.match(source, /competence_date\.gte\.\$\{period\.startDate\}/);
  assert.match(
    source,
    /migrated_card_purchase_id\.is\.null,transaction_role\.eq\.invoice_payment,cash_flow_kind\.eq\.invoice_payment/,
  );
  assert.match(source, /\.in\("status",\["realized","completed","posted","settled","paid","received","pending","partial"\]\)/);
  const movementQuery = source.slice(
    source.indexOf("getBankAccountMonthlyTransactions"),
    source.indexOf("export type MovementUnavailableSource"),
  );
  assert.doesNotMatch(movementQuery, /from\("card_purchases"\)/);
});
