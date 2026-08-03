import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildTransactionFingerprint,
  classifyPluggyRetry,
  deriveConnectionSyncStatus,
  incrementalWindowStart,
  interpretPluggyItemStatus,
  parsePluggyItemSyncStatus,
  parsePluggySyncResult,
  pluggyProductIsUpdated,
  resolveOverallSyncStatus,
  shouldApplyRemoteRecord,
  summarizeIncrementalSync,
  type PluggyResourceSyncResult,
} from "./incremental-sync";

const resource = (
  patch: Partial<PluggyResourceSyncResult>,
): PluggyResourceSyncResult => ({
  resourceType: "transactions",
  status: "succeeded",
  dataFreshness: "current",
  received: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  preserved: 0,
  skipped: 0,
  failed: 0,
  warningCodes: [],
  ...patch,
});

test("completed_with_warnings permite processar recursos disponíveis", () => {
  const result = interpretPluggyItemStatus({
    itemStatus: "UPDATED",
    executionStatus: "COMPLETED_WITH_WARNINGS",
  });
  assert.equal(result.canProcessAvailableResources, true);
  assert.equal(result.hardFailure, false);
  assert.equal(result.softFailure, true);
});

test("conta atualizada e cartão preservado concluem com warnings", () => {
  assert.equal(
    resolveOverallSyncStatus([
      resource({ resourceType: "accounts", inserted: 1 }),
      resource({ resourceType: "transactions", inserted: 6 }),
      resource({
        resourceType: "credit_cards",
        status: "preserved",
        dataFreshness: "stale",
        preserved: 100,
      }),
    ]),
    "completed_with_warnings",
  );
});

test("cenário 500 mais 100 preserva cartão e adiciona seis movimentos", () => {
  const previous = { bank: 500, card: 100 };
  const summary = summarizeIncrementalSync({
    syncRunId: "scenario",
    startedAt: "2026-07-28T16:03:00Z",
    warnings: ["connector_unavailable"],
    resources: [
      resource({
        resourceType: "transactions",
        entityType: "bank_account",
        received: 506,
        inserted: 6,
        unchanged: 500,
      }),
      resource({
        resourceType: "credit_cards",
        status: "preserved",
        dataFreshness: "stale",
        preserved: previous.card,
      }),
    ],
  });
  assert.equal(previous.bank + summary.totalInserted + previous.card, 606);
  assert.equal(summary.totalPreserved, 100);
  assert.equal(summary.overallStatus, "completed_with_warnings");
});

test("falha total ocorre somente sem recurso útil", () => {
  assert.equal(
    resolveOverallSyncStatus([
      resource({ status: "failed", dataFreshness: "unavailable", failed: 1 }),
      resource({ status: "preserved", dataFreshness: "stale", preserved: 10 }),
    ]),
    "failed",
  );
});

test("resumo soma inseridos, atualizados e preservados por recurso", () => {
  const summary = summarizeIncrementalSync({
    syncRunId: "run",
    startedAt: "2026-07-28T10:00:00Z",
    finishedAt: "2026-07-28T10:01:00Z",
    warnings: ["card_unavailable"],
    resources: [
      resource({ resourceType: "transactions", inserted: 6, updated: 2 }),
      resource({
        resourceType: "credit_cards",
        status: "preserved",
        dataFreshness: "stale",
        preserved: 100,
      }),
    ],
  });
  assert.equal(summary.overallStatus, "completed_with_warnings");
  assert.equal(summary.totalInserted, 6);
  assert.equal(summary.totalUpdated, 2);
  assert.equal(summary.totalPreserved, 100);
});

test("fingerprint muda com campo do provider e é estável para espaços", () => {
  const base = {
    providerId: "tx-1",
    accountId: "account-1",
    amount: 12.5,
    date: "2026-07-28T10:00:00Z",
    description: "Mercado Central",
    status: "PENDING",
  };
  assert.equal(
    buildTransactionFingerprint(base),
    buildTransactionFingerprint({ ...base, description: "  Mercado   Central " }),
  );
  assert.notEqual(
    buildTransactionFingerprint(base),
    buildTransactionFingerprint({ ...base, status: "POSTED" }),
  );
});

test("retry distingue falha temporária de credencial inválida", () => {
  assert.equal(classifyPluggyRetry({ status: 503 }).retryable, true);
  assert.equal(classifyPluggyRetry({ code: "CONNECTOR_OFFLINE" }).retryable, true);
  assert.equal(classifyPluggyRetry({ status: 403, code: "FORBIDDEN" }).retryable, false);
});

test("janela incremental usa dez dias de sobreposição", () => {
  assert.equal(
    incrementalWindowStart("2026-07-28T10:00:00Z"),
    "2026-07-18",
  );
});

test("PARTIAL_SUCCESS parses statusDetail per product", () => {
  const parsed = parsePluggyItemSyncStatus({
    status: "UPDATED",
    executionStatus: "PARTIAL_SUCCESS",
    statusDetail: {
      accounts: { isUpdated: true, lastUpdatedAt: "2026-08-02T12:00:00Z", warnings: [] },
      transactions: { isUpdated: false, lastUpdatedAt: "2026-07-25T12:00:00Z", warnings: [{ code: "TIMEOUT", message: "temporary" }] },
      creditCards: null,
    },
  });
  assert.equal(parsed.isPartial, true);
  assert.equal(pluggyProductIsUpdated(parsed, "accounts"), true);
  assert.equal(pluggyProductIsUpdated(parsed, "transactions"), false);
  assert.equal(parsed.products.find(product => product.product === "transactions")?.warnings[0]?.code, "TIMEOUT");
});

test("missing product on PARTIAL_SUCCESS is not assumed updated", () => {
  const parsed = parsePluggyItemSyncStatus({ status: "UPDATED", executionStatus: "PARTIAL_SUCCESS" });
  assert.equal(pluggyProductIsUpdated(parsed, "transactions"), false);
});

test("partial success imports valid card products and preserves failed bank products", () => {
  const finishedAt = "2026-08-03T16:15:00Z";
  const parsed = parsePluggySyncResult({
    item: {
      status: "UPDATED",
      executionStatus: "PARTIAL_SUCCESS",
      statusDetail: {
        accounts: { isUpdated: false, lastUpdatedAt: "2026-08-02T00:43:00Z" },
        transactions: { isUpdated: false, lastUpdatedAt: "2026-08-02T00:43:00Z" },
        creditCards: { isUpdated: true, lastUpdatedAt: finishedAt },
        bills: { isUpdated: true, lastUpdatedAt: finishedAt },
        loans: null,
      },
    },
    finishedAt,
    collectedResources: [
      resource({ resourceType: "accounts", status: "preserved", dataFreshness: "stale", preserved: 1 }),
      resource({ resourceType: "transactions", status: "preserved", dataFreshness: "stale", preserved: 500 }),
      resource({ resourceType: "credit_cards", received: 2, updated: 2 }),
      resource({ resourceType: "bills", received: 2, updated: 2 }),
    ],
  });
  assert.equal(parsed.overallResult, "partial_success");
  assert.equal(parsed.products.find(product => product.product === "creditCards")?.result, "updated");
  assert.equal(parsed.products.find(product => product.product === "bills")?.lastSuccessfulSyncAt, finishedAt);
  assert.equal(parsed.products.find(product => product.product === "transactions")?.result, "preserved");
  assert.equal(parsed.products.find(product => product.product === "loans")?.result, "not_available");
  assert.equal(
    deriveConnectionSyncStatus(parsed.products, ["accounts", "transactions", "creditCards", "bills"]),
    "partially_updated",
  );
});

test("secondary product failure produces warning without requiring attention", () => {
  const products = parsePluggySyncResult({
    item: { status: "UPDATED", executionStatus: "PARTIAL_SUCCESS" },
    collectedResources: [
      resource({ resourceType: "accounts", received: 1, updated: 1 }),
      resource({ resourceType: "transactions", received: 20, updated: 4 }),
      resource({ resourceType: "loans", status: "preserved", dataFreshness: "stale", preserved: 1 }),
    ],
  }).products;
  assert.equal(
    deriveConnectionSyncStatus(products, ["accounts", "transactions"]),
    "updated_with_warnings",
  );
});

test("valid rows from interrupted pagination advance product success but not integral status", () => {
  const products = parsePluggySyncResult({
    item: { status: "UPDATED", executionStatus: "PARTIAL_SUCCESS" },
    collectedResources: [resource({
      resourceType: "transactions",
      status: "succeeded_with_warnings",
      dataFreshness: "partially_current",
      received: 100,
      inserted: 6,
      warningCodes: ["pluggy_pagination_incomplete"],
    })],
  }).products;
  assert.equal(products[0]?.result, "partially_updated");
  assert.equal(products[0]?.hasValidPayload, true);
  assert.equal(deriveConnectionSyncStatus(products, ["transactions"]), "partially_updated");
});

test("remote precedence blocks an older provider snapshot", () => {
  assert.equal(shouldApplyRemoteRecord({
    localRemoteUpdatedAt: "2026-08-02T12:00:00Z",
    incomingRemoteUpdatedAt: "2026-08-01T12:00:00Z",
  }), false);
  assert.equal(shouldApplyRemoteRecord({
    localRemoteUpdatedAt: "2026-08-01T12:00:00Z",
    incomingRemoteUpdatedAt: "2026-08-02T12:00:00Z",
  }), true);
});

test("orquestrador persiste por recurso e não degrada todas as entidades", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  assert.match(source, /record_financial_resource_sync/);
  assert.match(source, /upsertPluggyTransactions/);
  assert.match(source, /provider_fingerprint/);
  assert.match(source, /if\(wants\("transactions"\)\)for/);
  assert.match(source, /if\(wants\("investments"\)\)try/);
  assert.match(source, /if\(wants\("loans"\)\)try/);
  assert.doesNotMatch(
    source,
    /for\(const table of \["financial_accounts","credit_cards"\][\s\S]*provider_status:resourceState/,
  );
});

test("migration cria freshness, retry, RLS e lock sem exclusão em massa", () => {
  const migration = readFileSync(
    "supabase/migrations/202607280045_incremental_resource_sync.sql",
    "utf8",
  );
  assert.match(migration, /create table if not exists public\.financial_resource_sync_status/);
  assert.match(migration, /provider_data_freshness/);
  assert.match(migration, /provider_fingerprint/);
  assert.match(migration, /next_retry_at/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /owner_id = auth\.uid\(\)/);
  assert.match(migration, /for update/);
  assert.doesNotMatch(migration, /\btruncate\b|\bdelete from public\.(financial_transactions|card_purchases)\b/i);
});

test("migration separates attempt, any success and integral success timestamps", () => {
  const migration = readFileSync(
    "supabase/migrations/202608030096_product_level_partial_sync.sql",
    "utf8",
  );
  assert.match(migration, /last_sync_attempt_at/);
  assert.match(migration, /last_any_success_at/);
  assert.match(migration, /last_integral_success_at/);
  assert.match(migration, /connection_sync_status/);
  assert.match(migration, /succeeded_with_warnings'[\s\S]*records_received > 0/);
});

test("credit card refresh is independent from accounts and bill fields are preserved separately", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  assert.match(source, /const providerValuesReliable=creditCardsProductUpdated/);
  assert.match(source, /if\(!billsProductUpdated\)for\(const field of billFields\)row\[field\]=undefined/);
  assert.doesNotMatch(source, /accountsProductUpdated&&creditCardsProductUpdated/);
});

test("specific item refresh rejection falls back to the current provider state", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  assert.match(source, /normalized\.status===400&&\/item\\s\+\(\?:can'\?t\|cannot\)\\s\+be\\s\+updated\/i/);
  assert.match(source, /if\(!updateRejected\)throw error;\s*return getPluggyItem\(itemId\)/);
  assert.match(source, /itemInterpretation\.hardFailure&&!hasUpdatedProduct/);
});

test("connection metadata uses the canonical run clock for optimistic locking", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  assert.match(source, /financial_sync_runs"\)\.select\("started_at"\)/);
  assert.match(source, /\.eq\("last_sync_started_at",runStartedAt\)/);
  assert.doesNotMatch(source, /\.lte\("last_sync_started_at",startedAt\)/);
});

test("cache invalidation is scoped by updated financial product", () => {
  const source = readFileSync("src/lib/pluggy/sync-cache.ts", "utf8");
  for (const tag of [
    "pluggy-item:",
    "financial-accounts:",
    "financial-transactions:",
    "financial-credit-cards:",
    "financial-bills:",
    "financial-reports:",
  ]) assert.match(source, new RegExp(tag));
  assert.match(source, /revalidateTag\(tag, \{ expire: 0 \}\)/);
});

test("interface traduz status e detalha recursos preservados", () => {
  const panel = readFileSync(
    "src/components/finance/pluggy-integration-panel.tsx",
    "utf8",
  );
  const actions = readFileSync(
    "src/app/financeiro/integracoes/actions.ts",
    "utf8",
  );
  assert.match(panel, /Atualização parcial/);
  assert.match(panel, /Detalhes da sincronização/);
  assert.match(panel, /Preservado/);
  assert.match(panel, /Tentar novamente/);
  assert.doesNotMatch(panel, /<b>\{run\.status\}<\/b>/);
  assert.match(actions, /resourceTypes:\[resource\]/);
  assert.match(actions, /últimos dados confiáveis/);
});
