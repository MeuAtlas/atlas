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

export type PluggyProductWarning = {
  code?: string;
  message?: string;
};

export type PluggyProductStatus = {
  product: string;
  isUpdated: boolean;
  lastUpdatedAt: string | null;
  warnings: PluggyProductWarning[];
};

export type ParsedPluggySyncStatus = {
  itemStatus: string | null;
  executionStatus: string | null;
  isPartial: boolean;
  products: PluggyProductStatus[];
};

const canonicalProductNames: Record<string, string> = {
  account: "accounts",
  accounts: "accounts",
  transaction: "transactions",
  transactions: "transactions",
  creditcard: "creditCards",
  creditcards: "creditCards",
  bill: "bills",
  bills: "bills",
  investment: "investments",
  investments: "investments",
  loan: "loans",
  loans: "loans",
  identity: "identity",
};

function canonicalProductName(value: string) {
  const compact = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return canonicalProductNames[compact] ?? value;
}

function productWarnings(value: unknown): PluggyProductWarning[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<PluggyProductWarning[]>((warnings, warning) => {
    if (typeof warning === "string") {
      warnings.push({ message: warning.slice(0, 300) });
      return warnings;
    }
    if (!warning || typeof warning !== "object") return warnings;
    const row = warning as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.slice(0, 100) : undefined;
    const message = typeof row.message === "string" ? row.message.slice(0, 300) : undefined;
    if (code || message) warnings.push({ code, message });
    return warnings;
  }, []);
}

export function parsePluggyItemSyncStatus(item: {
  status?: unknown;
  executionStatus?: unknown;
  statusDetail?: unknown;
}): ParsedPluggySyncStatus {
  const itemStatus = typeof item.status === "string" ? item.status : null;
  const executionStatus = typeof item.executionStatus === "string"
    ? item.executionStatus
    : null;
  const detail = item.statusDetail && typeof item.statusDetail === "object" &&
    !Array.isArray(item.statusDetail)
    ? item.statusDetail as Record<string, unknown>
    : {};
  const products = Object.entries(detail).flatMap(([product, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const value = raw as Record<string, unknown>;
    return [{
      product: canonicalProductName(product),
      isUpdated: value.isUpdated === true,
      lastUpdatedAt: typeof value.lastUpdatedAt === "string"
        ? value.lastUpdatedAt
        : null,
      warnings: productWarnings(value.warnings),
    }];
  });
  const normalizedExecution = executionStatus?.toUpperCase() ?? null;
  return {
    itemStatus,
    executionStatus,
    isPartial: ["PARTIAL_SUCCESS", "COMPLETED_WITH_WARNINGS", "WARNING"]
      .includes(normalizedExecution ?? ""),
    products,
  };
}

export function pluggyProductIsUpdated(
  parsed: ParsedPluggySyncStatus,
  product: string,
) {
  const match = parsed.products.find(candidate =>
    candidate.product === canonicalProductName(product));
  if (match) return match.isUpdated;
  return parsed.executionStatus?.toUpperCase() === "SUCCESS";
}

export function pluggyProductStatus(
  parsed: ParsedPluggySyncStatus,
  product: string,
) {
  return parsed.products.find(candidate =>
    candidate.product === canonicalProductName(product)) ?? null;
}

export function shouldApplyRemoteRecord(input: {
  localRemoteUpdatedAt?: string | null;
  incomingRemoteUpdatedAt?: string | null;
  localSyncedAt?: string | null;
  incomingSyncedAt?: string | null;
}) {
  const time = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = new Date(value).valueOf();
    return Number.isFinite(parsed) ? parsed : null;
  };
  const localRemote = time(input.localRemoteUpdatedAt);
  const incomingRemote = time(input.incomingRemoteUpdatedAt);
  if (localRemote !== null && incomingRemote !== null) {
    return incomingRemote >= localRemote;
  }
  if (localRemote !== null && incomingRemote === null) return false;
  const localSync = time(input.localSyncedAt);
  const incomingSync = time(input.incomingSyncedAt);
  if (localSync !== null && incomingSync !== null) return incomingSync >= localSync;
  return true;
}

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
  if (["OUTDATED", "LOGIN_ERROR", "UNAVAILABLE"].includes(providerStatus)) {
    warningCodes.push("provider_item_unavailable");
  }
  if (["UPDATING", "WAITING_USER_INPUT", "WAITING_USER_ACTION"]
    .includes(providerStatus)) warningCodes.push("provider_item_waiting");

  const terminalFailure = ["DELETED", "REVOKED"].includes(providerStatus) ||
    ["AUTH_ERROR", "FORBIDDEN"].includes(executionStatus);
  const canProcessAvailableResources = !terminalFailure &&
    (providerStatus === "UPDATED" ||
      ["SUCCESS", "PARTIAL_SUCCESS", "COMPLETED_WITH_WARNINGS", "WARNING"]
        .includes(executionStatus));
  const hardFailure = terminalFailure || !canProcessAvailableResources;
  const softFailure = !hardFailure && warningCodes.length > 0;

  return {
    canProcessAvailableResources,
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
  overlapDays = 10,
) {
  if (!lastSuccessfulSyncAt) return undefined;
  const parsed = new Date(lastSuccessfulSyncAt);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return new Date(parsed.valueOf() - overlapDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
