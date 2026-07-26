import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createProviderAlertIncidentId,
  dismissalStorageForSeverity,
  isAlertDismissed,
  persistAlertDismissal,
  type StorageLike,
} from "./dismissible-alert-state";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const incident = (overrides: Partial<Parameters<typeof createProviderAlertIncidentId>[0]> = {}) =>
  createProviderAlertIncidentId({
    provider: "pluggy",
    institution: "Santander",
    connectionId: "connection-1",
    providerStatus: "unavailable",
    dataCompleteness: "partial",
    syncStatus: "completed_with_warnings",
    incidentStartedAt: "2026-07-25T10:00:00Z",
    providerStatusAt: "2026-07-25T10:05:00Z",
    partialDataCount: 3,
    messageVersion: "provider-health-v2",
    ...overrides,
  });

test("dispensa informativa persiste por 24 horas no localStorage", () => {
  const storage = new MemoryStorage();
  const now = Date.UTC(2026, 6, 25, 12);
  const record = persistAlertDismissal({
    storage,
    key: incident(),
    severity: "warning",
    now,
  });
  assert.equal(dismissalStorageForSeverity("warning"), "local");
  assert.equal(record.expiresAt, now + 24 * 60 * 60 * 1000);
  assert.equal(isAlertDismissed(storage, incident(), now + 1000), true);
});

test("expiração remove a dispensa e faz o alerta reaparecer", () => {
  const storage = new MemoryStorage();
  const now = Date.UTC(2026, 6, 25, 12);
  persistAlertDismissal({
    storage,
    key: incident(),
    severity: "warning",
    now,
  });
  assert.equal(
    isAlertDismissed(storage, incident(), now + 24 * 60 * 60 * 1000),
    false,
  );
  assert.equal(storage.getItem(incident()), null);
});

test("novo incidente, status, sincronização ou mensagem geram nova chave", () => {
  const original = incident();
  assert.notEqual(
    original,
    incident({ incidentStartedAt: "2026-07-26T10:00:00Z" }),
  );
  assert.notEqual(
    original,
    incident({ providerStatusAt: "2026-07-25T11:05:00Z" }),
  );
  assert.notEqual(original, incident({ providerStatus: "waiting" }));
  assert.notEqual(original, incident({ messageVersion: "provider-health-v3" }));
});

test("alerta crítico usa somente a sessão atual", () => {
  assert.equal(dismissalStorageForSeverity("critical"), "session");
});

test("componente usa botão nativo acessível e oculta sem recarregar", () => {
  const component = readFileSync(
    "src/components/atlas/dismissible-alert.tsx",
    "utf8",
  );
  assert.match(component, /<button/);
  assert.match(component, /type="button"/);
  assert.match(component, /aria-label="Fechar aviso"/);
  assert.match(component, /title="Ocultar este aviso"/);
  assert.match(component, /onClick=\{dismiss\}/);
  assert.doesNotMatch(component, /location\.reload|router\.refresh/);
});

test("estilos cobrem temas, mobile, foco e reduced motion", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /var\(--atlas-surface-solid\)/);
  assert.match(css, /var\(--atlas-text\)/);
  assert.match(css, /\.dismissible-alert-close:focus-visible/);
  assert.match(css, /flex:0 0 44px/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.dismissible-alert-shell/);
});

test("aviso parcial da movimentação reutiliza o mesmo componente e timestamp", () => {
  const analysis = readFileSync(
    "src/components/finance/account-movement-analysis.tsx",
    "utf8",
  );
  assert.match(analysis, /DismissibleAlert/);
  assert.match(analysis, /createProviderAlertIncidentId/);
  assert.match(analysis, /movement\.lastSyncAt/);
  assert.match(analysis, /movement\.warnings\.join/);
});
