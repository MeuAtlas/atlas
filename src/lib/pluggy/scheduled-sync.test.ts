import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createPluggyCronHandler } from "./cron-handler";
import {
  executeScheduledPluggySync,
  pathsForUpdatedPluggyResources,
  type ScheduledPluggyIntegration,
  type ScheduledPluggySyncDependencies,
} from "./scheduled-sync";
import type {
  PluggyResourceSyncResult,
  PluggySyncSummary,
} from "./incremental-sync";

const integration = (id: string): ScheduledPluggyIntegration => ({
  id,
  ownerId: `owner-${id}`,
  workspaceId: `workspace-${id}`,
});

const resource = (
  patch: Partial<PluggyResourceSyncResult> = {},
): PluggyResourceSyncResult => ({
  resourceType: "accounts",
  status: "succeeded",
  dataFreshness: "current",
  received: 1,
  inserted: 1,
  updated: 0,
  unchanged: 0,
  preserved: 0,
  skipped: 0,
  failed: 0,
  warningCodes: [],
  ...patch,
});

const summary = (
  resources: PluggyResourceSyncResult[],
  status: PluggySyncSummary["overallStatus"] = "completed",
): PluggySyncSummary => ({
  syncRunId: "run",
  overallStatus: status,
  resources,
  totalInserted: resources.reduce((total, item) => total + item.inserted, 0),
  totalUpdated: resources.reduce((total, item) => total + item.updated, 0),
  totalPreserved: resources.reduce(
    (total, item) => total + item.preserved,
    0,
  ),
  warnings: [],
  startedAt: "2026-07-29T02:00:00.000Z",
  finishedAt: "2026-07-29T02:01:00.000Z",
});

const dependencies = (
  patch: Partial<ScheduledPluggySyncDependencies> = {},
): ScheduledPluggySyncDependencies => ({
  listActiveIntegrations: async () => [],
  acquireLock: async () => "lock",
  releaseLock: async () => undefined,
  runIncrementalPluggySync: async () => summary([resource()]),
  invalidateCaches: async () => undefined,
  ...patch,
});

test("rota rejeita chamada sem CRON_SECRET antes de criar cliente privilegiado", async () => {
  let dependenciesCreated = false;
  const handler = createPluggyCronHandler(
    () => {
      dependenciesCreated = true;
      return dependencies();
    },
    { getSecret: () => "cron-secret" },
  );
  const response = await handler(
    new Request("http://localhost/api/cron/pluggy-sync"),
  );
  assert.equal(response.status, 401);
  assert.equal(dependenciesCreated, false);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
});

test("rota aceita Bearer CRON_SECRET e conclui sem integrações", async () => {
  const handler = createPluggyCronHandler(dependencies(), {
    getSecret: () => "cron-secret",
  });
  const response = await handler(
    new Request("http://localhost/api/cron/pluggy-sync", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.integrations.total, 0);
});

test("lock impede execução concorrente da mesma integração", async () => {
  let locked = false;
  let syncCalls = 0;
  const result = await executeScheduledPluggySync(
    dependencies({
      listActiveIntegrations: async () => [
        integration("same"),
        integration("same"),
      ],
      acquireLock: async () => {
        if (locked) return null;
        locked = true;
        return "token";
      },
      releaseLock: async () => undefined,
      runIncrementalPluggySync: async () => {
        syncCalls++;
        return summary([resource()]);
      },
    }),
  );
  assert.equal(syncCalls, 1);
  assert.equal(result.integrations.locked, 1);
});

test("conta atualiza quando cartão falha e execução permanece parcial", async () => {
  const partial = summary(
    [
      resource({ resourceType: "accounts", inserted: 1 }),
      resource({
        resourceType: "credit_cards",
        status: "preserved",
        dataFreshness: "stale",
        inserted: 0,
        preserved: 1,
        warningCodes: ["provider_partial"],
      }),
    ],
    "completed_with_warnings",
  );
  const result = await executeScheduledPluggySync(
    dependencies({
      listActiveIntegrations: async () => [integration("one")],
      runIncrementalPluggySync: async () => partial,
    }),
  );
  assert.equal(result.status, "completed_with_warnings");
  assert.equal(result.records.inserted, 1);
  assert.equal(result.resources.updated, 1);
  assert.equal(result.resources.preserved, 1);
});

test("completed_with_warnings retorna HTTP 200 como sucesso parcial", async () => {
  const handler = createPluggyCronHandler(
    dependencies({
      listActiveIntegrations: async () => [integration("partial")],
      runIncrementalPluggySync: async () =>
        summary(
          [resource({ status: "succeeded_with_warnings" })],
          "completed_with_warnings",
        ),
    }),
    { getSecret: () => "secret" },
  );
  const response = await handler(
    new Request("http://localhost/api/cron/pluggy-sync", {
      headers: { authorization: "Bearer secret" },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "completed_with_warnings");
});

test("falha de uma integração não impede as demais", async () => {
  const called: string[] = [];
  const result = await executeScheduledPluggySync(
    dependencies({
      listActiveIntegrations: async () => [
        integration("broken"),
        integration("healthy"),
      ],
      runIncrementalPluggySync: async item => {
        called.push(item.id);
        if (item.id === "broken") throw new Error("provider token=secret");
        return summary([resource()]);
      },
    }),
  );
  assert.deepEqual(called.sort(), ["broken", "healthy"]);
  assert.equal(result.integrations.failed, 1);
  assert.equal(result.integrations.completed, 1);
});

test("concorrência é limitada", async () => {
  let active = 0;
  let maximum = 0;
  await executeScheduledPluggySync(
    dependencies({
      concurrency: 2,
      listActiveIntegrations: async () =>
        ["1", "2", "3", "4"].map(integration),
      runIncrementalPluggySync: async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return summary([resource()]);
      },
    }),
  );
  assert.equal(maximum, 2);
});

test("cache financeiro é invalidado somente para recurso atualizado", () => {
  const paths = pathsForUpdatedPluggyResources(
    summary([
      resource({ resourceType: "accounts", inserted: 1 }),
      resource({
        resourceType: "credit_cards",
        status: "preserved",
        dataFreshness: "stale",
        inserted: 0,
        preserved: 1,
      }),
    ]),
  );
  assert.equal(paths.has("/financeiro/contas"), true);
  assert.equal(paths.has("/financeiro/cartoes"), false);
});

test("rota não expõe erro interno nem segredo", async () => {
  const handler = createPluggyCronHandler(
    dependencies({
      listActiveIntegrations: async () => {
        throw new Error("database password cron-secret bank-data");
      },
    }),
    { getSecret: () => "cron-secret" },
  );
  const response = await handler(
    new Request("http://localhost/api/cron/pluggy-sync", {
      headers: { authorization: "Bearer cron-secret" },
    }),
  );
  const serialized = JSON.stringify(await response.json());
  assert.equal(response.status, 503);
  assert.equal(serialized.includes("cron-secret"), false);
  assert.equal(serialized.includes("bank-data"), false);
  assert.equal(serialized.includes("password"), false);
});

test("implementação consulta somente integrações ativas e registra scheduled", () => {
  const server = readFileSync(
    "src/lib/pluggy/scheduled-sync-server.ts",
    "utf8",
  );
  assert.match(server, /\.eq\("provider", "pluggy"\)/);
  assert.match(server, /\.eq\("status", "active"\)/);
  assert.match(server, /\.eq\("automatic_sync_enabled", true\)/);
  assert.match(server, /triggerType: "scheduled"/);
  assert.match(server, /runIncrementalPluggySync/);
});

test("migration cria preferência e lock por workspace e integração", () => {
  const migration = readFileSync(
    "supabase/migrations/202607280047_scheduled_pluggy_sync.sql",
    "utf8",
  );
  assert.match(migration, /automatic_sync_enabled boolean not null default true/);
  assert.match(migration, /financial_sync_locks_workspace_integration_idx/);
  assert.match(migration, /acquire_scheduled_pluggy_sync_lock/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
});
