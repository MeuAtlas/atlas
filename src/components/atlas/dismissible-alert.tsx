"use client";

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  dismissalStorageForSeverity,
  isAlertDismissed,
  persistAlertDismissal,
  type DismissalStorageKind,
  type DismissibleAlertSeverity,
} from "./dismissible-alert-state";

export function DismissibleAlert({
  id,
  title,
  message,
  severity = "warning",
  dismissible = true,
  persistDismissal,
  expiresAt,
  onDismiss,
  className = "",
  details,
  actions,
}: {
  id: string;
  title: string;
  message: string;
  severity?: DismissibleAlertSeverity;
  dismissible?: boolean;
  persistDismissal?: DismissalStorageKind;
  expiresAt?: number | null;
  onDismiss?: () => void;
  className?: string;
  details?: ReactNode;
  actions?: ReactNode;
}) {
  const [hidden, setHidden] = useState(false);
  const [exiting, setExiting] = useState(false);
  const storageKind =
    persistDismissal ?? dismissalStorageForSeverity(severity);
  const storageKey = `atlas.dismissed-alert:${id}`;

  useEffect(() => {
    if (!dismissible || storageKind === "none") return;
    const storage =
      storageKind === "session" ? window.sessionStorage : window.localStorage;
    const frame = window.requestAnimationFrame(() => {
      if (isAlertDismissed(storage, storageKey)) setHidden(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dismissible, storageKey, storageKind]);

  const dismiss = () => {
    if (storageKind !== "none") {
      const storage =
        storageKind === "session" ? window.sessionStorage : window.localStorage;
      persistAlertDismissal({
        storage,
        key: storageKey,
        severity,
        expiresAt,
      });
    }
    setExiting(true);
    onDismiss?.();
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.setTimeout(() => setHidden(true), reduceMotion ? 0 : 200);
  };

  if (hidden) return null;
  return (
    <div
      className={`dismissible-alert-shell${exiting ? " exiting" : ""}`}
      data-severity={severity}
    >
      <aside
        className={`dismissible-alert ${className}`.trim()}
        role={severity === "critical" ? "alert" : "status"}
        aria-live={severity === "critical" ? "assertive" : "polite"}
      >
        <div className="dismissible-alert-content">
          <b>{title}</b>
          <p>{message}</p>
          {details ? <small>{details}</small> : null}
        </div>
        <div className="dismissible-alert-actions">
          {actions}
          {dismissible ? (
            <button
              type="button"
              className="dismissible-alert-close"
              onClick={dismiss}
              aria-label="Fechar aviso"
              title="Ocultar este aviso"
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
