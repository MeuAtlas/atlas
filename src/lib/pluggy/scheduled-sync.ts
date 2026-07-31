import type {
  PluggyResourceType,
  PluggySyncSummary,
} from "./incremental-sync";

export type ScheduledPluggyIntegration = {
  id: string;
  ownerId: string;
  workspaceId: string | null;
};

export type ScheduledIntegrationResult = {
  status: "completed" | "completed_with_warnings" | "failed" | "locked";
  durationMs: number;
  resourcesUpdated: number;
  resourcesPreserved: number;
  resourcesFailed: number;
  recordsInserted: number;
  recordsUpdated: number;
};

export type ScheduledPluggySyncDependencies = {
  listActiveIntegrations(): Promise<ScheduledPluggyIntegration[]>;
  acquireLock(integration: ScheduledPluggyIntegration): Promise<string | null>;
  releaseLock(
    integration: ScheduledPluggyIntegration,
    token: string,
  ): Promise<void>;
  runIncrementalPluggySync(
    integration: ScheduledPluggyIntegration,
  ): Promise<PluggySyncSummary>;
  invalidateCaches(
    integration: ScheduledPluggyIntegration,
    summary: PluggySyncSummary,
  ): Promise<void>;
  concurrency?: number;
  now?: () => number;
};

export type ScheduledPluggySyncResult = {
  status: "completed" | "completed_with_warnings";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  integrations: {
    total: number;
    completed: number;
    partial: number;
    failed: number;
    locked: number;
  };
  resources: {
    updated: number;
    preserved: number;
    failed: number;
  };
  records: {
    inserted: number;
    updated: number;
  };
};

const successfulStatuses = new Set(["succeeded", "succeeded_with_warnings"]);

export function updatedPluggyResourceTypes(summary: PluggySyncSummary) {
  return new Set<PluggyResourceType>(
    summary.resources
      .filter(
        resource =>
          successfulStatuses.has(resource.status) &&
          resource.inserted + resource.updated > 0,
      )
      .map(resource => resource.resourceType),
  );
}

export function pathsForUpdatedPluggyResources(summary: PluggySyncSummary) {
  const resources = updatedPluggyResourceTypes(summary);
  const paths = new Set<string>(["/financeiro/integracoes"]);
  if (resources.has("accounts")) {
    paths.add("/financeiro");
    paths.add("/financeiro/contas");
  }
  if (resources.has("transactions")) {
    paths.add("/financeiro");
    paths.add("/financeiro/movimentacoes");
    paths.add("/financeiro/planejamento");
    paths.add("/financeiro/relatorios");
  }
  if (resources.has("credit_cards") || resources.has("bills")) {
    paths.add("/financeiro");
    paths.add("/financeiro/cartoes");
    paths.add("/financeiro/planejamento");
  }
  if (resources.has("loans")) {
    paths.add("/financeiro/emprestimos");
    paths.add("/financeiro/planejamento");
  }
  if (resources.has("investments")) paths.add("/financeiro");
  return paths;
}

function summarizeIntegration(
  summary: PluggySyncSummary,
  durationMs: number,
): ScheduledIntegrationResult {
  return {
    status: summary.overallStatus,
    durationMs,
    resourcesUpdated: summary.resources.filter(resource =>
      successfulStatuses.has(resource.status),
    ).length,
    resourcesPreserved: summary.resources.filter(
      resource => resource.status === "preserved",
    ).length,
    resourcesFailed: summary.resources.filter(resource =>
      ["failed", "unavailable"].includes(resource.status),
    ).length,
    recordsInserted: summary.totalInserted,
    recordsUpdated: summary.totalUpdated,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await task(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function executeScheduledPluggySync(
  dependencies: ScheduledPluggySyncDependencies,
): Promise<ScheduledPluggySyncResult> {
  const now = dependencies.now ?? Date.now;
  const started = now();
  const startedAt = new Date(started).toISOString();
  const integrations = await dependencies.listActiveIntegrations();
  const results = await mapWithConcurrency(
    integrations,
    dependencies.concurrency ?? 2,
    async integration => {
      const integrationStarted = now();
      let token: string | null = null;
      try {
        token = await dependencies.acquireLock(integration);
        if (!token) {
          return {
            status: "locked",
            durationMs: now() - integrationStarted,
            resourcesUpdated: 0,
            resourcesPreserved: 0,
            resourcesFailed: 0,
            recordsInserted: 0,
            recordsUpdated: 0,
          } satisfies ScheduledIntegrationResult;
        }
        const summary =
          await dependencies.runIncrementalPluggySync(integration);
        await dependencies.invalidateCaches(integration, summary);
        return summarizeIntegration(summary, now() - integrationStarted);
      } catch {
        return {
          status: "failed",
          durationMs: now() - integrationStarted,
          resourcesUpdated: 0,
          resourcesPreserved: 0,
          resourcesFailed: 0,
          recordsInserted: 0,
          recordsUpdated: 0,
        } satisfies ScheduledIntegrationResult;
      } finally {
        if (token) {
          try {
            await dependencies.releaseLock(integration, token);
          } catch {
            // The lock expires automatically; a release failure must not leak details.
          }
        }
      }
    },
  );

  const finished = now();
  const totals = {
    completed: results.filter(result => result.status === "completed").length,
    partial: results.filter(
      result => result.status === "completed_with_warnings",
    ).length,
    failed: results.filter(result => result.status === "failed").length,
    locked: results.filter(result => result.status === "locked").length,
  };
  const degraded = totals.partial + totals.failed + totals.locked > 0;
  return {
    status: degraded ? "completed_with_warnings" : "completed",
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    integrations: {
      total: integrations.length,
      ...totals,
    },
    resources: {
      updated: results.reduce(
        (total, result) => total + result.resourcesUpdated,
        0,
      ),
      preserved: results.reduce(
        (total, result) => total + result.resourcesPreserved,
        0,
      ),
      failed: results.reduce(
        (total, result) => total + result.resourcesFailed,
        0,
      ),
    },
    records: {
      inserted: results.reduce(
        (total, result) => total + result.recordsInserted,
        0,
      ),
      updated: results.reduce(
        (total, result) => total + result.recordsUpdated,
        0,
      ),
    },
  };
}
