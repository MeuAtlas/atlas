import "server-only";

import { maskId } from "./diagnostics";
import { syncPluggyItem } from "./sync";
import { invalidatePluggySyncCaches } from "./sync-cache";
import type {
  ScheduledPluggyIntegration,
  ScheduledPluggySyncDependencies,
} from "./scheduled-sync";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function runIncrementalPluggySync(
  supabase: AdminClient,
  integration: ScheduledPluggyIntegration,
) {
  const started = Date.now();
  const result = await syncPluggyItem(
    supabase as Parameters<typeof syncPluggyItem>[0],
    integration.ownerId,
    integration.id,
    false,
    { triggerType: "scheduled" },
  );
  console.info("[Atlas Pluggy Scheduled Integration]", {
    operation: "pluggy.scheduled.integration",
    connection: maskId(integration.id),
    triggerType: "scheduled",
    status: result.summary.overallStatus,
    startedAt: result.summary.startedAt,
    finishedAt: result.summary.finishedAt,
    durationMs: Date.now() - started,
    resourcesUpdated: result.summary.resources.filter(resource =>
      ["succeeded", "succeeded_with_warnings"].includes(resource.status),
    ).length,
    resourcesPreserved: result.summary.resources.filter(
      resource => resource.status === "preserved",
    ).length,
    resourcesFailed: result.summary.resources.filter(resource =>
      ["failed", "unavailable"].includes(resource.status),
    ).length,
  });
  return result.summary;
}

export function createScheduledPluggyDependencies(): ScheduledPluggySyncDependencies {
  const supabase = createAdminClient();
  return {
    concurrency: 2,
    async listActiveIntegrations() {
      const connections = await supabase
        .from("bank_connections")
        .select("id,owner_id,workspace_id")
        .eq("provider", "pluggy")
        .eq("status", "active")
        .eq("automatic_sync_enabled", true)
        .order("created_at", { ascending: true });
      if (connections.error) throw new Error("scheduled_connections_unavailable");
      return (connections.data ?? []).map(connection => ({
        id: String(connection.id),
        ownerId: String(connection.owner_id),
        workspaceId: connection.workspace_id
          ? String(connection.workspace_id)
          : null,
      }));
    },
    async acquireLock(integration) {
      const lock = await supabase.rpc("acquire_scheduled_pluggy_sync_lock", {
        target_connection: integration.id,
        lock_ttl_seconds: 3300,
      });
      if (lock.error) throw new Error("scheduled_lock_unavailable");
      return lock.data ? String(lock.data) : null;
    },
    async releaseLock(integration, token) {
      const released = await supabase.rpc(
        "release_scheduled_pluggy_sync_lock",
        {
          target_connection: integration.id,
          target_token: token,
        },
      );
      if (released.error) throw new Error("scheduled_lock_release_failed");
    },
    runIncrementalPluggySync: integration =>
      runIncrementalPluggySync(supabase, integration),
    invalidateCaches: (integration, summary) =>
      invalidatePluggySyncCaches({
        supabase,
        ownerId: integration.ownerId,
        workspaceId: integration.workspaceId,
        integrationId: integration.id,
        summary,
      }),
  };
}
