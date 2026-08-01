import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFinanceIntegrationsDashboard,
  nextDailySyncAt,
  resolveIntegrationHealthStatus,
  type IntegrationConnectionInput,
  type IntegrationDashboardInput,
  type IntegrationResourceInput,
  type RecentSyncActivity,
} from "./integrations-dashboard";

const root = process.cwd();
const component = readFileSync(join(root, "src/components/finance/pluggy-integration-panel.tsx"), "utf8");
const query = readFileSync(join(root, "src/modules/finance/integrations-dashboard-query.ts"), "utf8");
const cache = readFileSync(join(root, "src/modules/finance/integrations-cache.ts"), "utf8");
const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
const migration = readFileSync(join(root, "supabase/migrations/202607280045_incremental_resource_sync.sql"), "utf8");

const connection: IntegrationConnectionInput = {
  id: "connection-1",
  connectorName: "Banco Santander",
  status: "active",
  syncStatus: "completed",
  automaticSyncEnabled: true,
  lastProviderUpdateAt: "2026-08-01T04:00:00.000Z",
  lastSuccessfulSyncAt: "2026-08-01T04:00:00.000Z",
  lastCompleteSyncAt: "2026-08-01T04:00:00.000Z",
  lastSyncAt: "2026-08-01T04:00:00.000Z",
  providerStatus: "available",
  dataCompleteness: "complete",
  incidentMessage: null,
  staleSince: null,
  connectionErrorMessage: null,
  maskedItem: "abcd…wxyz",
  diagnostics: { creditAccounts: 2, instruments: 2, pending: 0 },
};
const run: RecentSyncActivity = {
  id: "run-1",
  connectionId: connection.id,
  status: "completed",
  triggerType: "scheduled",
  startedAt: "2026-08-01T04:00:00.000Z",
  completedAt: "2026-08-01T04:00:55.000Z",
  durationMs: 55_000,
  resourcesSucceeded: 5,
  resourcesFailed: 0,
  resourcesPreserved: 0,
  recordsInserted: 2,
  recordsUpdated: 1250,
  recordsPreserved: 0,
  warningCodes: [],
};
const resource: IntegrationResourceInput = {
  id: "resource-1",
  connectionId: connection.id,
  syncRunId: run.id,
  resourceType: "accounts",
  entityType: "bank_account",
  providerEntityId: "account-1",
  status: "succeeded",
  dataFreshness: "current",
  lastAttemptAt: run.startedAt,
  lastSuccessfulSyncAt: run.completedAt,
  received: 1,
  inserted: 0,
  updated: 1,
  preserved: 0,
  safeMessage: null,
  errorCode: null,
  retryable: false,
  metadata: { name: "Banco Santander" },
};

function input(overrides: Partial<IntegrationDashboardInput> = {}): IntegrationDashboardInput {
  return {
    configured: true,
    connections: [connection],
    resources: [resource],
    runs: [run],
    cardDiagnostics: [],
    warnings: {},
    now: new Date("2026-08-01T12:00:00.000Z"),
    ...overrides,
  };
}

test("conexão atualizada usa linguagem humana", () => {
  const dashboard = buildFinanceIntegrationsDashboard(input());
  assert.equal(dashboard.primaryConnection?.health.overallStatus, "updated");
  assert.equal(dashboard.primaryConnection?.health.title, "Atualizada");
});

test("conexão parcialmente atualizada preserva o último estado confiável", () => {
  const partialConnection = { ...connection, syncStatus: "warning", dataCompleteness: "partial" };
  const dashboard = buildFinanceIntegrationsDashboard(input({ connections: [partialConnection] }));
  assert.equal(dashboard.primaryConnection?.health.overallStatus, "partial");
  assert.match(dashboard.primaryConnection?.partialMessage ?? "", /último estado confiável/);
});

test("conexão com autenticação vencida requer atenção", () => {
  const health = resolveIntegrationHealthStatus({
    connection: { ...connection, connectionErrorMessage: "MFA expired" },
    products: [], runs: [run], nextScheduledSyncAt: null,
  });
  assert.equal(health.overallStatus, "attention");
  assert.equal(health.requiresAction, true);
});

test("ausência de conexão resolve estado desconectado", () => {
  const dashboard = buildFinanceIntegrationsDashboard(input({ connections: [], resources: [], runs: [] }));
  assert.equal(dashboard.primaryConnection, null);
  assert.equal(resolveIntegrationHealthStatus({ connection: null, products: [], runs: [], nextScheduledSyncAt: null }).overallStatus, "disconnected");
});

test("execução em andamento resolve estado sincronizando", () => {
  const health = resolveIntegrationHealthStatus({
    connection: { ...connection, syncStatus: "running" }, products: [], runs: [], nextScheduledSyncAt: null,
  });
  assert.equal(health.overallStatus, "syncing");
});

for (const [raw, expected] of [
  ["succeeded", "updated"],
  ["preserved", "preserved"],
  ["unavailable", "unavailable"],
] as const) {
  test(`produto ${expected} é normalizado`, () => {
    const dashboard = buildFinanceIntegrationsDashboard(input({
      resources: [{ ...resource, status: raw }],
    }));
    assert.equal(dashboard.products[0]?.status, expected);
  });
}

test("mensagem parcial existe somente no card principal do DTO", () => {
  const dashboard = buildFinanceIntegrationsDashboard(input({
    connections: [{ ...connection, syncStatus: "warning" }],
  }));
  assert.ok(dashboard.primaryConnection?.partialMessage);
  assert.equal(dashboard.attentionItems.some(item => item.title === "Atualização parcial"), false);
});

test("atividade recente contém somente três execuções", () => {
  const runs = Array.from({ length: 7 }, (_, index) => ({ ...run, id: `run-${index}` }));
  const dashboard = buildFinanceIntegrationsDashboard(input({ runs }));
  assert.equal(dashboard.recentActivity.length, 3);
  assert.equal(dashboard.syncHistory.length, 7);
});

test("histórico completo possui modal, filtros e paginação", () => {
  assert.match(component, /function FullSyncHistoryModal/);
  assert.match(component, /history-filters/);
  assert.match(component, /history-pagination/);
});

test("sincronização automática ativada calcula próxima execução", () => {
  const dashboard = buildFinanceIntegrationsDashboard(input());
  assert.equal(dashboard.automaticSync?.enabled, true);
  assert.equal(nextDailySyncAt(new Date("2026-08-01T12:00:00.000Z")), "2026-08-02T02:00:00.000Z");
});

test("automática sem execução gera alerta acionável", () => {
  const dashboard = buildFinanceIntegrationsDashboard(input({ runs: [{ ...run, triggerType: "manual" }] }));
  assert.ok(dashboard.attentionItems.some(item => item.id === "automatic-not-run"));
});

test("Item ID fica recolhido quando existe conexão ativa", () => {
  assert.match(component, /<details className="advanced-subsection">[\s\S]*Vínculo manual por Item ID/);
  assert.match(component, /dashboard\.primaryConnection \? \(/);
});

test("estado sem conexão oferece vínculo manual secundário", () => {
  assert.match(component, /Nenhuma conexão financeira/);
  assert.match(component, /Vincular Item manualmente/);
});

test("diagnóstico técnico fica somente nas configurações avançadas", () => {
  const advancedIndex = component.indexOf("function AdvancedIntegrationSettings");
  const diagnosticIndex = component.indexOf("Diagnóstico de cartões");
  assert.ok(diagnosticIndex > advancedIndex);
  assert.doesNotMatch(component.slice(0, advancedIndex), /Diagnóstico de cartões/);
});

test("menu secundário contém ressincronização e histórico", () => {
  assert.match(component, /integration-more-menu/);
  assert.match(component, /Ressincronizar tudo/);
  assert.match(component, /Ver histórico completo/);
});

test("desvincular exige confirmação em modal", () => {
  assert.match(component, /function ConfirmationModal/);
  assert.match(component, /Desvincular MeuPluggy\?/);
  assert.doesNotMatch(component, /window\.confirm/);
});

test("consulta central limita histórico e não faz requests no client", () => {
  assert.match(query, /export async function getFinanceIntegrationsDashboard/);
  assert.match(query, /\.limit\(15\)/);
  assert.doesNotMatch(component, /\.from\(|fetch\(/);
});

test("cache possui as cinco tags e invalidação imediata", () => {
  for (const value of ["finance:integrations", "finance:integration", "finance:sync-history", "finance:sync-products", "finance:automatic-sync"]) {
    assert.match(cache, new RegExp(value));
  }
  assert.match(cache, /revalidateTag\(tag, \{ expire: 0 \}\)/);
});

test("RLS mantém recursos de sincronização restritos ao proprietário", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /using \(owner_id = auth\.uid\(\)\)/);
});

test("layout possui contrato mobile sem tabela horizontal", () => {
  assert.match(css, /@media\(max-width:640px\)[\s\S]*integrations-dashboard/);
  assert.doesNotMatch(component, /<table/);
});
