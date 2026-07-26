export type DismissibleAlertSeverity = "info" | "warning" | "critical";
export type DismissalStorageKind = "local" | "session" | "none";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type DismissalRecord = {
  dismissedAt: number;
  expiresAt: number | null;
};

export const DISMISSAL_TTL_BY_SEVERITY: Record<
  DismissibleAlertSeverity,
  number | null
> = {
  info: 24 * 60 * 60 * 1000,
  warning: 24 * 60 * 60 * 1000,
  critical: null,
};

export function dismissalStorageForSeverity(
  severity: DismissibleAlertSeverity,
): DismissalStorageKind {
  return severity === "critical" ? "session" : "local";
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const slug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "provider";

export function createProviderAlertIncidentId(input: {
  provider: string;
  institution: string;
  connectionId: string;
  providerStatus: string;
  dataCompleteness: string;
  syncStatus: string;
  incidentStartedAt: string | null;
  providerStatusAt: string | null;
  partialDataCount: number;
  messageVersion: string;
}) {
  const fingerprint = [
    input.connectionId,
    input.providerStatus,
    input.dataCompleteness,
    input.syncStatus,
    input.incidentStartedAt,
    input.providerStatusAt,
    input.partialDataCount,
    input.messageVersion,
  ].join("|");
  return `provider-warning:${slug(input.provider)}:${slug(input.institution)}:${stableHash(fingerprint)}`;
}

export function isAlertDismissed(
  storage: StorageLike,
  key: string,
  now = Date.now(),
) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return false;
    const record = JSON.parse(raw) as Partial<DismissalRecord>;
    if (
      typeof record.dismissedAt !== "number" ||
      (record.expiresAt !== null && typeof record.expiresAt !== "number")
    ) {
      storage.removeItem(key);
      return false;
    }
    if (record.expiresAt !== null && record.expiresAt <= now) {
      storage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function persistAlertDismissal({
  storage,
  key,
  severity,
  now = Date.now(),
  expiresAt,
}: {
  storage: StorageLike;
  key: string;
  severity: DismissibleAlertSeverity;
  now?: number;
  expiresAt?: number | null;
}) {
  const configuredTtl = DISMISSAL_TTL_BY_SEVERITY[severity];
  const record: DismissalRecord = {
    dismissedAt: now,
    expiresAt:
      expiresAt === undefined
        ? configuredTtl === null
          ? null
          : now + configuredTtl
        : expiresAt,
  };
  try {
    storage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage can be disabled by browser privacy settings. The component still
    // dismisses locally for the current render.
  }
  return record;
}
