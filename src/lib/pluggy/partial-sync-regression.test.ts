import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  interpretPluggyItemStatus,
  parsePluggyItemSyncStatus,
  pluggyProductIsUpdated,
} from "./incremental-sync";

test("SUCCESS treats products as updated when statusDetail is absent", () => {
  const parsed = parsePluggyItemSyncStatus({
    status: "UPDATED",
    executionStatus: "SUCCESS",
    statusDetail: null,
  });
  assert.equal(pluggyProductIsUpdated(parsed, "accounts"), true);
  assert.equal(pluggyProductIsUpdated(parsed, "transactions"), true);
});

test("waiting and login states preserve data instead of importing snapshots", () => {
  for (const itemStatus of ["UPDATING", "WAITING_USER_INPUT", "WAITING_USER_ACTION", "LOGIN_ERROR", "OUTDATED"]) {
    const interpreted = interpretPluggyItemStatus({ itemStatus, executionStatus: null });
    assert.equal(interpreted.canProcessAvailableResources, false);
    assert.equal(interpreted.hardFailure, true);
  }
});

test("central sync uses checkpoint for bank accounts and at least 45 days for cards", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  const actions = readFileSync("src/app/financeiro/integracoes/actions.ts", "utf8");
  assert.match(source, /financial_resource_sync_status\.transaction_checkpoints/);
  assert.match(source, /incrementalWindowStart\(transactionCheckpoints\.get\(account\.id\)\)/);
  assert.doesNotMatch(source, /incrementalWindowStart\(connection\.data\.last_successful_sync_at/);
  assert.match(source, /Date\.now\(\)-45\*86_400_000/);
  assert.match(actions, /recoveryWindowDays:90/);
});

test("manual-field lookups are chunked below PostgREST header limits", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  assert.match(source, /existingRowsByExternalId/);
  assert.doesNotMatch(source, /\.in\("external_id",rows\.map\(/);
});

test("partial products are gated independently and empty partial pages are not successful", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  const pagination = readFileSync("src/lib/pluggy/transactions-pagination.ts", "utf8");
  for (const product of ["accounts", "transactions", "creditCards", "bills", "investments", "loans"]) {
    assert.match(source, new RegExp(`pluggyProductIsUpdated\\(parsedItemStatus,\\"${product}\\"\\)`));
  }
  assert.match(source, /pluggy_partial_empty_transactions/);
  assert.match(source, /listAllPluggyTransactions/);
  assert.match(pagination, /pluggy_pagination_repeated_cursor/);
});

test("transaction webhooks share the central pipeline and deletion is logical", () => {
  const route = readFileSync("src/app/api/pluggy/webhook/route.ts", "utf8");
  const migration = readFileSync("supabase/migrations/202608020080_fix_partial_pluggy_sync.sql", "utf8");
  for (const event of ["transactions/created", "transactions/updated", "transactions/deleted"]) {
    assert.match(route, new RegExp(event.replace("/", "\\/")));
  }
  assert.match(route, /syncPluggyItem/);
  assert.match(route, /deletedTransactionIds/);
  assert.match(migration, /is_provider_deleted/);
  assert.match(migration, /provider_deleted_at/);
  assert.doesNotMatch(migration, /delete from public\.(financial_transactions|card_purchases)/i);
});

test("execution audit and account-level freshness are persisted", () => {
  const migration = readFileSync("supabase/migrations/202608020080_fix_partial_pluggy_sync.sql", "utf8");
  for (const field of [
    "last_accounts_sync_at",
    "last_transactions_sync_at",
    "last_balance_sync_at",
    "last_transaction_date",
    "item_status",
    "execution_status",
    "raw_status_detail",
    "transactions_deleted",
  ]) assert.match(migration, new RegExp(field));
});

test("remote account id used by webhook deletion is guaranteed by migration", () => {
  const migration = readFileSync("supabase/migrations/202608020083_repair_transaction_provider_account.sql", "utf8");
  assert.match(migration, /add column if not exists provider_account_id text/);
  assert.match(migration, /financial_transactions_provider_account_idx/);
});

test("schema drift repair keeps the provider transaction balance", () => {
  const migration = readFileSync(
    new URL("../../../supabase/migrations/202608020084_repair_transaction_provider_balance.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column if not exists provider_balance numeric\(15,2\)/);
});

test("execution audit writes through an owner-validated RPC", () => {
  const source = readFileSync("src/lib/pluggy/sync.ts", "utf8");
  const migration = readFileSync("supabase/migrations/202608020081_secure_pluggy_execution_audit.sql", "utf8");
  assert.match(source, /rpc\("update_financial_sync_run_provider_status"/);
  assert.match(migration, /security definer/);
  assert.match(migration, /run_owner <> auth\.uid\(\)/);
});

test("integration UI separates attempts, movement freshness and balance freshness", () => {
  const panel = readFileSync("src/components/finance/pluggy-integration-panel.tsx", "utf8");
  assert.match(panel, /Última tentativa/);
  assert.match(panel, /Última atualização das movimentações/);
  assert.match(panel, /Última movimentação recebida/);
  assert.match(panel, /Última atualização do saldo/);
  assert.match(panel, /Recuperar 45 dias/);
});
