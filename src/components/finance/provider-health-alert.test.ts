import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync("src/components/finance/provider-health-alert.tsx", "utf8");
const notifications = readFileSync("src/components/finance/finance-notifications.tsx", "utf8");
const shell = readFileSync("src/components/finance/finance-shell.tsx", "utf8");
const integrations = readFileSync("src/components/finance/pluggy-integration-panel.tsx", "utf8");
const layout = readFileSync("src/app/financeiro/layout.tsx", "utf8");

test("global provider banner is limited to connections requiring action", () => {
  assert.match(layout, /ProviderHealthAlerts/);
  assert.match(component, /isCriticalProviderHealth/);
  assert.match(component, /severity="critical"/);
  assert.match(component, /lastCompleteSyncAt/);
  assert.match(component, /Tentar novamente/);
  assert.match(component, /Ver detalhes/);
  assert.doesNotMatch(component, /parcialmente indisponíveis/);
  assert.doesNotMatch(component, /incident_message|connection_error_message/);
});

test("critical provider alert keeps reusable dismissal and incident identity", () => {
  assert.match(component, /DismissibleAlert/);
  assert.match(component, /createProviderAlertIncidentId/);
  assert.match(component, /incidentStartedAt/);
  assert.match(component, /lastSyncAt/);
  assert.match(component, /MESSAGE_VERSION/);
  assert.match(layout, /stale_since/);
});

test("authentication and consent states remain critical", () => {
  assert.match(component, /auth\|login\|consent\|reauth\|disconnected\|action_required/);
  assert.match(component, /severity="critical"/);
});

test("partial provider state is routed to the notification bell", () => {
  assert.match(layout, /providerHealth=\{connections\}/);
  assert.match(shell, /FinanceNotifications/);
  assert.match(notifications, /!isCriticalProviderHealth\(connection\)/);
  assert.match(notifications, /atualizado parcialmente/);
  assert.match(notifications, /finance-notifications-badge/);
  assert.match(notifications, /aria-expanded=\{open\}/);
  assert.match(notifications, /atlas:notification-seen:/);
  assert.match(notifications, /useSyncExternalStore/);
  assert.match(notifications, /window\.dispatchEvent\(new Event\(SEEN_EVENT\)\)/);
  assert.match(notifications, /\{unreadCount \?/);
});

test("integrations keeps only the connection-level sync button", () => {
  const header = integrations.slice(
    integrations.indexOf("export function IntegrationsPageHeader"),
    integrations.indexOf("export function IntegrationSummaryMetrics"),
  );
  assert.doesNotMatch(header, /SyncAction/);
  assert.match(integrations, /<SyncAction connectionId=\{connection\.id\}/);
});
