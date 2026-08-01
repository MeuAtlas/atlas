export type IntegrationOverallStatus =
  | "updated"
  | "partial"
  | "attention"
  | "disconnected"
  | "syncing";

export type IntegrationProductStatus =
  | "updated"
  | "partial"
  | "preserved"
  | "unavailable"
  | "authentication_required";

export type FinanceConnectionHealth = {
  overallStatus: IntegrationOverallStatus;
  title: string;
  description: string;
  severity: "success" | "warning" | "danger" | "neutral" | "progress";
  lastSuccessfulSyncAt: string | null;
  lastFullSyncAt: string | null;
  nextScheduledSyncAt: string | null;
  requiresAction: boolean;
  actionLabel: string | null;
  actionHref: string | null;
};

export type IntegrationProductSummary = {
  id: string;
  connectionId: string;
  name: string;
  type: string;
  status: IntegrationProductStatus;
  freshness: string;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  recordsReceived: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsPreserved: number;
  safeMessage: string | null;
  requiresAction: boolean;
  resourceType: string;
};

export type AutomaticSyncSummary = {
  enabled: boolean;
  available: boolean;
  frequency: "daily";
  hour: string;
  timezone: string;
  nextScheduledSyncAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunDurationMs: number | null;
};

export type IntegrationAttentionItem = {
  id: string;
  title: string;
  description: string;
  severity: "warning" | "danger";
  actionLabel: string;
  target: "product" | "automatic" | "advanced";
  targetId?: string;
};

export type RecentSyncActivity = {
  id: string;
  connectionId: string;
  status: string;
  triggerType: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  resourcesSucceeded: number;
  resourcesFailed: number;
  resourcesPreserved: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsPreserved: number;
  warningCodes: string[];
};

export type AdvancedCardDiagnostic = {
  id: string;
  name: string;
  lastFour: string;
  received: number;
  mapped: number;
  persisted: number;
  included: number;
  excluded: number;
  pages: number;
};

export type AdvancedIntegrationDiagnostics = {
  configured: boolean;
  maskedItem: string | null;
  creditAccounts: number;
  instruments: number;
  pendingInstruments: number;
  cardDiagnostics: AdvancedCardDiagnostic[];
  sectionWarnings: string[];
};

export type FinanceIntegrationDashboard = {
  header: {
    eyebrow: "INTEGRAÇÕES";
    title: "Integrações financeiras";
    subtitle: string;
  };
  primaryConnection: {
    id: string;
    name: string;
    provider: "MeuPluggy";
    health: FinanceConnectionHealth;
    lastUpdateAt: string | null;
    lastFullSyncAt: string | null;
    nextScheduledSyncAt: string | null;
    accountCount: number;
    cardCount: number;
    investmentCount: number;
    loanCount: number;
    partialMessage: string | null;
  } | null;
  products: IntegrationProductSummary[];
  automaticSync: AutomaticSyncSummary | null;
  attentionItems: IntegrationAttentionItem[];
  recentActivity: RecentSyncActivity[];
  syncHistory: RecentSyncActivity[];
  advancedDiagnostics: AdvancedIntegrationDiagnostics;
};

export type IntegrationConnectionInput = {
  id: string;
  connectorName: string | null;
  status: string;
  syncStatus: string;
  automaticSyncEnabled: boolean;
  lastProviderUpdateAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastCompleteSyncAt: string | null;
  lastSyncAt: string | null;
  providerStatus: string;
  dataCompleteness: string;
  incidentMessage: string | null;
  staleSince: string | null;
  connectionErrorMessage: string | null;
  maskedItem: string;
  diagnostics: {
    creditAccounts: number;
    instruments: number;
    pending: number;
  };
};

export type IntegrationResourceInput = {
  id: string;
  connectionId: string;
  syncRunId: string;
  resourceType: string;
  entityType: string | null;
  providerEntityId: string;
  status: string;
  dataFreshness: string;
  lastAttemptAt: string | null;
  lastSuccessfulSyncAt: string | null;
  received: number;
  inserted: number;
  updated: number;
  preserved: number;
  safeMessage: string | null;
  errorCode: string | null;
  retryable: boolean;
  metadata: Record<string, unknown>;
};

export type IntegrationDashboardInput = {
  configured: boolean;
  connections: IntegrationConnectionInput[];
  resources: IntegrationResourceInput[];
  runs: RecentSyncActivity[];
  cardDiagnostics: AdvancedCardDiagnostic[];
  warnings: Record<string, boolean>;
  now?: Date;
};

const authenticationSignals = ["auth", "credential", "mfa", "login"];
const visibleResources = new Set([
  "accounts",
  "credit_cards",
  "loans",
  "investments",
]);

export function nextDailySyncAt(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  const next = new Date(`${value("year")}-${value("month")}-${value("day")}T23:00:00-03:00`);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function resolveIntegrationHealthStatus(input: {
  connection: IntegrationConnectionInput | null;
  products: IntegrationProductSummary[];
  runs: RecentSyncActivity[];
  nextScheduledSyncAt: string | null;
}): FinanceConnectionHealth {
  const { connection, products, runs, nextScheduledSyncAt } = input;
  if (!connection) {
    return {
      overallStatus: "disconnected",
      title: "Desconectada",
      description: "Nenhuma fonte financeira está conectada ao Atlas.",
      severity: "neutral",
      lastSuccessfulSyncAt: null,
      lastFullSyncAt: null,
      nextScheduledSyncAt: null,
      requiresAction: true,
      actionLabel: "Conectar MeuPluggy",
      actionHref: null,
    };
  }
  const latestRun = runs.find(run => run.connectionId === connection.id) ?? null;
  const signal = `${connection.status} ${connection.syncStatus} ${connection.providerStatus} ${connection.connectionErrorMessage ?? ""}`.toLowerCase();
  if (connection.syncStatus === "running" || latestRun?.status === "running") {
    return {
      overallStatus: "syncing",
      title: "Sincronizando",
      description: "Os dados financeiros estão sendo atualizados agora.",
      severity: "progress",
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      lastFullSyncAt: connection.lastCompleteSyncAt,
      nextScheduledSyncAt,
      requiresAction: false,
      actionLabel: null,
      actionHref: null,
    };
  }
  const authenticationRequired = authenticationSignals.some(item => signal.includes(item));
  const unavailableCritical = products.some(product =>
    ["Conta corrente", "Movimentações"].includes(product.type) &&
    product.status === "unavailable" && !product.lastSuccessfulSyncAt,
  );
  if (authenticationRequired || connection.status === "error" || unavailableCritical) {
    return {
      overallStatus: "attention",
      title: "Requer atenção",
      description: authenticationRequired
        ? "A instituição precisa de uma nova autenticação para continuar atualizando."
        : "Uma fonte essencial não conseguiu atualizar os dados.",
      severity: "danger",
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      lastFullSyncAt: connection.lastCompleteSyncAt,
      nextScheduledSyncAt,
      requiresAction: true,
      actionLabel: "Ver detalhes",
      actionHref: null,
    };
  }
  const partial = connection.dataCompleteness === "partial" ||
    ["warning", "completed_with_warnings"].includes(connection.syncStatus) ||
    products.some(product => ["partial", "preserved", "unavailable"].includes(product.status));
  if (partial) {
    return {
      overallStatus: "partial",
      title: "Atualizada parcialmente",
      description: "Os produtos disponíveis foram atualizados e os demais mantiveram o último estado confiável.",
      severity: "warning",
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
      lastFullSyncAt: connection.lastCompleteSyncAt,
      nextScheduledSyncAt,
      requiresAction: false,
      actionLabel: "Ver detalhes",
      actionHref: null,
    };
  }
  return {
    overallStatus: "updated",
    title: "Atualizada",
    description: "Todos os produtos financeiros relevantes estão atuais.",
    severity: "success",
    lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt,
    lastFullSyncAt: connection.lastCompleteSyncAt,
    nextScheduledSyncAt,
    requiresAction: false,
    actionLabel: null,
    actionHref: null,
  };
}

function productType(resource: IntegrationResourceInput) {
  if (resource.resourceType === "accounts") return "Conta corrente";
  if (resource.resourceType === "transactions") return "Movimentações";
  if (resource.resourceType === "credit_cards") return "Cartão de crédito";
  if (resource.resourceType === "bills") return "Faturas";
  if (resource.resourceType === "investments") return "Investimentos";
  if (resource.resourceType === "loans") return "Empréstimos";
  return "Produto financeiro";
}

function productName(resource: IntegrationResourceInput, connectionName: string) {
  const metadataName = resource.metadata.name ?? resource.metadata.display_name;
  const lastFour = resource.metadata.last_four_digits ?? resource.metadata.lastFour;
  if (typeof metadataName === "string" && metadataName.trim()) {
    return typeof lastFour === "string" && lastFour.trim()
      ? `${metadataName.trim()} · ${lastFour.trim()}`
      : metadataName.trim();
  }
  if (resource.resourceType === "accounts") return connectionName;
  return productType(resource);
}

function productStatus(resource: IntegrationResourceInput): IntegrationProductStatus {
  const error = `${resource.errorCode ?? ""} ${resource.safeMessage ?? ""}`.toLowerCase();
  if (authenticationSignals.some(item => error.includes(item))) return "authentication_required";
  if (resource.status === "succeeded") return "updated";
  if (resource.status === "succeeded_with_warnings") return "partial";
  if (resource.status === "preserved") return "preserved";
  return "unavailable";
}

function durationMs(run: RecentSyncActivity) {
  if (!run.completedAt) return null;
  return Math.max(0, new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime());
}

export function buildFinanceIntegrationsDashboard(
  input: IntegrationDashboardInput,
): FinanceIntegrationDashboard {
  const connection = input.connections[0] ?? null;
  const now = input.now ?? new Date();
  const connectionRuns = connection
    ? input.runs.filter(run => run.connectionId === connection.id)
    : [];
  const latestRun = connectionRuns[0] ?? null;
  const resourceCandidates = connection
    ? input.resources.filter(resource => resource.connectionId === connection.id)
    : [];
  const latestResources = latestRun
    ? resourceCandidates.filter(resource => resource.syncRunId === latestRun.id)
    : resourceCandidates;
  const seen = new Set<string>();
  const products = latestResources
    .filter(resource => visibleResources.has(resource.resourceType))
    .filter(resource => {
      const key = `${resource.resourceType}:${resource.providerEntityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(resource => {
      const relatedResources = latestResources.filter(candidate => {
        if (!["transactions", "bills"].includes(candidate.resourceType)) return false;
        if (candidate.providerEntityId === resource.providerEntityId) return true;
        const candidateName = candidate.metadata.name ?? candidate.metadata.display_name;
        const resourceMetadataName = resource.metadata.name ?? resource.metadata.display_name;
        return typeof candidateName === "string" && typeof resourceMetadataName === "string" &&
          candidateName.trim() === resourceMetadataName.trim();
      });
      const relatedStatus = relatedResources.map(productStatus);
      const ownStatus = productStatus(resource);
      const status: IntegrationProductStatus = relatedStatus.includes("authentication_required")
        ? "authentication_required"
        : relatedStatus.includes("unavailable")
          ? "partial"
          : relatedStatus.some(value => ["partial", "preserved"].includes(value))
            ? "partial"
            : ownStatus;
      return {
        id: resource.id,
        connectionId: resource.connectionId,
        name: productName(resource, connection?.connectorName || "Conta conectada"),
        type: productType(resource),
        status,
        freshness: resource.dataFreshness,
        lastAttemptAt: resource.lastAttemptAt,
        lastSuccessfulSyncAt: resource.lastSuccessfulSyncAt,
        recordsReceived: resource.received,
        recordsInserted: resource.inserted,
        recordsUpdated: resource.updated,
        recordsPreserved: resource.preserved,
        safeMessage: resource.safeMessage ?? relatedResources.find(item => item.safeMessage)?.safeMessage ?? null,
        requiresAction: resource.retryable || relatedResources.some(item => item.retryable) || status === "authentication_required",
        resourceType: resource.resourceType,
      } satisfies IntegrationProductSummary;
    });
  const automaticRun = connectionRuns.find(run => run.triggerType === "scheduled") ?? null;
  const nextScheduledSyncAt = connection?.automaticSyncEnabled ? nextDailySyncAt(now) : null;
  const health = resolveIntegrationHealthStatus({
    connection,
    products,
    runs: connectionRuns,
    nextScheduledSyncAt,
  });
  const attentionItems: IntegrationAttentionItem[] = [];
  const authProduct = products.find(product => product.status === "authentication_required");
  if (authProduct) attentionItems.push({
    id: `auth-${authProduct.id}`,
    title: "A instituição precisa de autenticação",
    description: "Confirme o acesso no MeuPluggy para retomar as atualizações.",
    severity: "danger",
    actionLabel: "Ver detalhes",
    target: "product",
    targetId: authProduct.id,
  });
  if ((connection?.diagnostics.pending ?? 0) > 0) attentionItems.push({
    id: "pending-instruments",
    title: `${connection?.diagnostics.pending} compras sem cartão identificado`,
    description: "Revise os instrumentos para melhorar a organização das faturas.",
    severity: "warning",
    actionLabel: "Revisar",
    target: "advanced",
  });
  if (connection?.automaticSyncEnabled && !automaticRun) attentionItems.push({
    id: "automatic-not-run",
    title: "Sincronização automática ainda não executada",
    description: "A rotina está ativa e fará a primeira atualização no próximo horário programado.",
    severity: "warning",
    actionLabel: "Configurar",
    target: "automatic",
  });
  const sectionWarnings = Object.entries(input.warnings)
    .filter(([, warning]) => warning)
    .map(([section]) => section);
  return {
    header: {
      eyebrow: "INTEGRAÇÕES",
      title: "Integrações financeiras",
      subtitle: "Conecte suas fontes financeiras e acompanhe a atualização dos dados.",
    },
    primaryConnection: connection ? {
      id: connection.id,
      name: connection.connectorName || "Instituição conectada",
      provider: "MeuPluggy",
      health,
      lastUpdateAt: connection.lastSyncAt ?? connection.lastProviderUpdateAt,
      lastFullSyncAt: connection.lastCompleteSyncAt,
      nextScheduledSyncAt,
      accountCount: latestRun?.resourcesSucceeded ? Math.max(latestRun.resourcesSucceeded > 0 ? 1 : 0, 0) : 0,
      cardCount: connection.diagnostics.creditAccounts,
      investmentCount: products.filter(product => product.resourceType === "investments").length,
      loanCount: products.filter(product => product.resourceType === "loans").length,
      partialMessage: health.overallStatus === "partial"
        ? "A conta corrente e os demais produtos disponíveis foram atualizados. Alguns dados permaneceram com o último estado confiável."
        : null,
    } : null,
    products,
    automaticSync: connection ? {
      enabled: connection.automaticSyncEnabled,
      available: !input.warnings.automaticSync,
      frequency: "daily",
      hour: "23:00",
      timezone: "America/Sao_Paulo",
      nextScheduledSyncAt,
      lastRunAt: automaticRun?.startedAt ?? null,
      lastRunStatus: automaticRun?.status ?? null,
      lastRunDurationMs: automaticRun ? durationMs(automaticRun) : null,
    } : null,
    attentionItems,
    recentActivity: connectionRuns.slice(0, 3),
    syncHistory: connectionRuns,
    advancedDiagnostics: {
      configured: input.configured,
      maskedItem: connection?.maskedItem ?? null,
      creditAccounts: connection?.diagnostics.creditAccounts ?? 0,
      instruments: connection?.diagnostics.instruments ?? 0,
      pendingInstruments: connection?.diagnostics.pending ?? 0,
      cardDiagnostics: input.cardDiagnostics,
      sectionWarnings,
    },
  };
}
