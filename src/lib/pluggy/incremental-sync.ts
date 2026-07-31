import { createHash } from "node:crypto";

export type PluggyResourceType =
  | "item"
  | "connector"
  | "identity"
  | "accounts"
  | "transactions"
  | "credit_cards"
  | "bills"
  | "loans"
  | "investments";

export type PluggyResourceStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "succeeded_with_warnings"
  | "failed"
  | "unavailable"
  | "preserved"
  | "skipped";

export type PluggyDataFreshness =
  | "current"
  | "partially_current"
  | "stale"
  | "unavailable"
  | "unknown";

export type PluggyResourceSyncResult = {
  resourceType: PluggyResourceType;
  entityType?: string | null;
  entityId?: string | null;
  localEntityId?: string | null;
  status: PluggyResourceStatus;
  dataFreshness: PluggyDataFreshness;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  preserved: number;
  skipped: number;
  failed: number;
  lastSuccessfulSyncAt?: string | null;
  errorCode?: string | null;
  warningCodes: string[];
  retryable?: boolean;
  metadata?: Record<string, unknown>;
};

export type PluggyOverallSyncStatus =
  | "completed"
  | "completed_with_warnings"
  | "failed";

export type PluggySyncSummary = {
  syncRunId: string;
  overallStatus: PluggyOverallSyncStatus;
  resources: PluggyResourceSyncResult[];
  totalInserted: number;
  totalUpdated: number;
  totalPreserved: number;
  warnings: string[];
  startedAt: string;
  finishedAt: string;
};

const usefulStatuses = new Set<PluggyResourceStatus>([
  "succeeded",
  "succeeded_with_warnings",
]);

const degradedStatuses = new Set<PluggyResourceStatus>([
  "succeeded_with_warnings",
  "failed",
  "unavailable",
  "preserved",
]);

const dataResources = new Set<PluggyResourceType>([
  "accounts",
  "transactions",
  "credit_cards",
  "bills",
  "loans",
  "investments",
]);

export function interpretPluggyItemStatus(input: {
  itemStatus?: string | null;
  executionStatus?: string | null;
}) {
  const providerStatus = String(input.itemStatus ?? "unknown").toUpperCase();
  const executionStatus = String(input.executionStatus ?? "").toUpperCase();
  const warningCodes: string[] = [];

  if (
    ["PARTIAL_SUCCESS", "COMPLETED_WITH_WARNINGS", "WARNING"].includes(
      executionStatus,
    )
  ) {
    warningCodes.push("provider_partial_success");
  }
  if (
    ["OUTDATED", "LOGIN_ERROR", "UNAVAILABLE"].includes(providerStatus)
  ) {
    warningCodes.push("provider_item_unavailable");
  }

  const hardFailure =
    ["DELETED", "REVOKED"].includes(providerStatus) ||
    ["AUTH_ERROR", "FORBIDDEN"].includes(executionStatus);
  const softFailure = !hardFailure && warningCodes.length > 0;

  return {
    canProcessAvailableResources: !hardFailure,
    providerStatus,
    warningCodes,
    hardFailure,
    softFailure,
  };
}

export function resolveOverallSyncStatus(
  resources: PluggyResourceSyncResult[],
): PluggyOverallSyncStatus {
  const relevant = resources.filter((resource) => resource.status !== "skipped");
  const useful = relevant.filter(
    (resource) =>
      dataResources.has(resource.resourceType) &&
      usefulStatuses.has(resource.status),
  );
  if (!useful.length) return "failed";
  return relevant.some((resource) => degradedStatuses.has(resource.status))
    ? "completed_with_warnings"
    : "completed";
}

export function summarizeIncrementalSync(input: {
  syncRunId: string;
  resources: PluggyResourceSyncResult[];
  warnings: string[];
  startedAt: string;
  finishedAt?: string;
}): PluggySyncSummary {
  return {
    syncRunId: input.syncRunId,
    overallStatus: resolveOverallSyncStatus(input.resources),
    resources: input.resources,
    totalInserted: input.resources.reduce(
      (total, resource) => total + resource.inserted,
      0,
    ),
    totalUpdated: input.resources.reduce(
      (total, resource) => total + resource.updated,
      0,
    ),
    totalPreserved: input.resources.reduce(
      (total, resource) => total + resource.preserved,
      0,
    ),
    warnings: input.warnings,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt ?? new Date().toISOString(),
  };
}

export function buildTransactionFingerprint(input: {
  providerId: string;
  accountId: string;
  amount: number;
  date: string;
  description: string;
  status?: string | null;
  providerCategory?: string | null;
  originalCurrency?: string | null;
}) {
  const canonical = [
    input.providerId,
    input.accountId,
    Number(input.amount).toFixed(8),
    input.date.slice(0, 10),
    input.description.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
    String(input.status ?? "").toUpperCase(),
    String(input.providerCategory ?? "").normalize("NFKC").trim().toLowerCase(),
    String(input.originalCurrency ?? "").toUpperCase(),
  ].join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}

export function classifyPluggyRetry(error: {
  status?: number | null;
  code?: string | null;
}) {
  const code = String(error.code ?? "").toUpperCase();
  const status = Number(error.status ?? 0);
  const retryable =
    status === 429 ||
    status >= 500 ||
    [
      "TIMEOUT",
      "NETWORK_ERROR",
      "CONNECTOR_OFFLINE",
      "ITEM_ALREADY_UPDATING",
      "CLIENT_IS_UPDATING_BEFORE_ALLOWED_FREQUENCY",
      "PARTIAL_PROVIDER_FAILURE",
    ].some((candidate) => code.includes(candidate));
  return {
    retryable,
    category: retryable ? "temporary" : "permanent",
  } as const;
}

export function incrementalWindowStart(
  lastSuccessfulSyncAt: string | null | undefined,
  overlapDays = 7,
) {
  if (!lastSuccessfulSyncAt) return undefined;
  const parsed = new Date(lastSuccessfulSyncAt);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return new Date(parsed.valueOf() - overlapDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
