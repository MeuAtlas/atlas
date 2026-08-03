"use client";

import Link from "next/link";
import { useActionState } from "react";
import { DismissibleAlert } from "@/components/atlas/dismissible-alert";
import { createProviderAlertIncidentId } from "@/components/atlas/dismissible-alert-state";
import {
  syncItemAction,
  type IntegrationActionState,
} from "@/app/financeiro/integracoes/actions";

export type ProviderHealth = {
  id: string;
  connectorName: string | null;
  providerStatus: string;
  dataCompleteness: string;
  syncStatus: string;
  lastSyncAt: string | null;
  lastCompleteSyncAt: string | null;
  incidentStartedAt: string | null;
  partialDataCount: number;
};

const initial: IntegrationActionState = { status: "idle", message: "" };
const MESSAGE_VERSION = "provider-health-v2";
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "ainda não disponível";

function Retry({ connectionId }: { connectionId: string }) {
  const [state, action, pending] = useActionState(syncItemAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="connection_id" value={connectionId} />
      <button disabled={pending}>
        {pending ? "Tentando…" : "Tentar novamente"}
      </button>
      {state.message ? <small role="status">{state.message}</small> : null}
    </form>
  );
}

export function isCriticalProviderHealth(connection: ProviderHealth) {
  return /auth|login|consent|reauth|disconnected|action_required/i.test(
    connection.providerStatus,
  );
}

export function isProviderHealthAffected(connection: ProviderHealth) {
  return connection.providerStatus !== "available" ||
    connection.dataCompleteness !== "complete" ||
    ["failed", "completed_with_warnings", "warning"].includes(connection.syncStatus);
}

export function ProviderHealthAlerts({
  connections,
}: {
  connections: ProviderHealth[];
}) {
  const affected = connections.filter(
    connection => isProviderHealthAffected(connection) && isCriticalProviderHealth(connection),
  );
  if (!affected.length) return null;
  return (
    <div className="provider-health-alerts">
      {affected.map((connection) => {
        const santander = /santander/i.test(connection.connectorName ?? "");
        const name = santander
          ? "Santander"
          : connection.connectorName || "provedor";
        const title = `Conexão do ${name} requer atenção`;
        const incidentId = createProviderAlertIncidentId({
          provider: "pluggy",
          institution: name,
          connectionId: connection.id,
          providerStatus: connection.providerStatus,
          dataCompleteness: connection.dataCompleteness,
          syncStatus: connection.syncStatus,
          incidentStartedAt: connection.incidentStartedAt,
          providerStatusAt: connection.lastSyncAt,
          partialDataCount: connection.partialDataCount,
          messageVersion: MESSAGE_VERSION,
        });
        return (
          <DismissibleAlert
            id={incidentId}
            key={incidentId}
            className="provider-health-alert"
            severity="critical"
            title={title}
            message="A conexão precisa de autenticação ou consentimento para voltar a atualizar os dados."
            details={
              <>
                Última sincronização confiável:{" "}
                {date(connection.lastCompleteSyncAt)} · sincronização atual:{" "}
                {date(connection.lastSyncAt)} · dados ausentes estimados:{" "}
                {connection.partialDataCount}
              </>
            }
            actions={
              <>
                <Retry connectionId={connection.id} />
                <Link href="/financeiro/integracoes" prefetch={false}>Ver detalhes</Link>
              </>
            }
          />
        );
      })}
    </div>
  );
}
