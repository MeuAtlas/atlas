import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  "src/components/finance/provider-health-alert.tsx",
  "utf8",
);
const layout = readFileSync("src/app/financeiro/layout.tsx", "utf8");

test("alerta global cobre todas as páginas financeiras sem erro técnico bruto", () => {
  assert.match(layout, /ProviderHealthAlerts/);
  assert.match(component, /parcialmente indisponíveis/);
  assert.match(component, /Última sincronização confiável/);
  assert.match(component, /Tentar novamente/);
  assert.match(component, /Ver detalhes/);
  assert.doesNotMatch(component, /incident_message|connection_error_message/);
});

test("alerta da Pluggy usa dispensa reutilizável e incidente versionado", () => {
  assert.match(component, /DismissibleAlert/);
  assert.match(component, /createProviderAlertIncidentId/);
  assert.match(component, /incidentStartedAt/);
  assert.match(component, /lastSyncAt/);
  assert.match(component, /MESSAGE_VERSION/);
  assert.match(layout, /stale_since/);
});

test("autenticação e consentimento pendentes usam gravidade crítica", () => {
  assert.match(component, /auth\|login\|consent\|reauth\|disconnected\|action_required/);
  assert.match(component, /"critical"/);
});
