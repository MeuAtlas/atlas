"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createProviderAlertIncidentId } from "@/components/atlas/dismissible-alert-state";
import {
  isCriticalProviderHealth,
  isProviderHealthAffected,
  type ProviderHealth,
} from "./provider-health-alert";

const NOTIFICATION_VERSION = "finance-provider-notification-v1";
const SEEN_EVENT = "atlas:notification-seen";
const seenStorageKey = (id: string) => `atlas:notification-seen:${id}`;

function subscribeToSeenNotifications(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(SEEN_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(SEEN_EVENT, onStoreChange);
  };
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

const formatDate = (value: string | null) => value
  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "horário indisponível";

function notificationTitle(connection: ProviderHealth) {
  const name = connection.connectorName || "Pluggy";
  if (connection.providerStatus === "waiting") return `${name} aguarda nova sincronização`;
  if (connection.providerStatus === "unavailable" || connection.syncStatus === "failed") return `${name} temporariamente indisponível`;
  return `${name} atualizado parcialmente`;
}

function notificationId(connection: ProviderHealth) {
  return createProviderAlertIncidentId({
    provider: "pluggy",
    institution: connection.connectorName || "Pluggy",
    connectionId: connection.id,
    providerStatus: connection.providerStatus,
    dataCompleteness: connection.dataCompleteness,
    syncStatus: connection.syncStatus,
    incidentStartedAt: connection.incidentStartedAt,
    providerStatusAt: connection.lastSyncAt,
    partialDataCount: connection.partialDataCount,
    messageVersion: NOTIFICATION_VERSION,
  });
}

export function FinanceNotifications({ connections }: { connections: ProviderHealth[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const notifications = useMemo(() => connections
    .filter(connection => isProviderHealthAffected(connection) && !isCriticalProviderHealth(connection))
    .map(connection => ({ connection, id: notificationId(connection) })), [connections]);
  const getUnreadCount = useCallback(() => notifications
    .filter(notification => window.localStorage.getItem(seenStorageKey(notification.id)) !== "1")
    .length, [notifications]);
  const unreadCount = useSyncExternalStore(
    subscribeToSeenNotifications,
    getUnreadCount,
    () => 0,
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const toggleNotifications = () => {
    if (!open) {
      const ids = notifications.map(notification => notification.id);
      for (const id of ids) window.localStorage.setItem(seenStorageKey(id), "1");
      window.dispatchEvent(new Event(SEEN_EVENT));
    }
    setOpen(value => !value);
  };

  return (
    <div className="finance-notifications-shell" ref={rootRef}>
      <button
        type="button"
        className="finance-notifications"
        aria-label="Notificações"
        aria-expanded={open}
        aria-controls="finance-notifications-panel"
        onClick={toggleNotifications}
      >
        <BellIcon />
        {unreadCount ? <span className="finance-notifications-badge">{unreadCount}</span> : null}
      </button>
      {open ? (
        <section id="finance-notifications-panel" className="finance-notifications-panel" aria-label="Notificações financeiras">
          <header><h2>Notificações</h2><span>{notifications.length || "Nenhuma nova"}</span></header>
          {notifications.length ? (
            <div className="finance-notifications-list">
              {notifications.map(({ connection, id }) => (
                <article key={id}>
                  <span className="finance-notification-status" aria-hidden="true" />
                  <div>
                    <h3>{notificationTitle(connection)}</h3>
                    <p>Parte dos dados não foi atualizada. O último estado confiável permanece preservado.</p>
                    <small>Atualização: {formatDate(connection.lastSyncAt)}</small>
                    <Link href="/financeiro/integracoes" prefetch={false} onClick={() => setOpen(false)}>Ver detalhes</Link>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="finance-notifications-empty">Nenhuma notificação financeira no momento.</p>}
        </section>
      ) : null}
    </div>
  );
}
