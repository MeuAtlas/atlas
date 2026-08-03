import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getPluggyConfigurationStatus } from "@/lib/pluggy/client";
import { requireQuery, withQueryFallback } from "@/lib/supabase/query-fallback";
import {
  buildFinanceIntegrationsDashboard,
  type AdvancedCardDiagnostic,
  type IntegrationConnectionInput,
  type IntegrationResourceInput,
  type RecentSyncActivity,
} from "./integrations-dashboard";

const mask = (value: string) =>
  value.length < 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;

export async function getFinanceIntegrationsDashboard(input: {
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string | null;
}) {
  let connectionQuery = input.supabase
    .from("bank_connections")
    .select(
      "id,workspace_id,provider_connection_id,connector_name,status,sync_status,last_provider_update_at,last_successful_sync_at,connection_error_message",
    )
    .eq("owner_id", input.userId)
    .eq("provider", "pluggy")
    .neq("status", "disabled")
    .order("created_at", { ascending: false });
  connectionQuery = input.workspaceId
    ? connectionQuery.eq("workspace_id", input.workspaceId)
    : connectionQuery.is("workspace_id", null);
  const connectionRows = await requireQuery("bank_connections", connectionQuery);
  const connectionIds = connectionRows.map(row => String(row.id));

  const [health, history, creditProducts, pending, cardRows, resourceRows, automatic, accountFreshness] =
    await Promise.all([
      withQueryFallback(
        "provider_incidents",
        input.supabase.from("bank_connections")
          .select("id,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count")
          .eq("owner_id", input.userId).eq("provider", "pluggy")
          .neq("status", "disabled"),
        [],
      ),
      withQueryFallback(
        "financial_sync_runs",
        input.supabase.from("financial_sync_runs")
          .select("id,bank_connection_id,status,trigger_type,started_at,completed_at,resources_succeeded,resources_failed,resources_preserved,records_inserted,records_updated,records_preserved,warning_codes,error_code,error_message")
          .eq("owner_id", input.userId).order("started_at", { ascending: false })
          .limit(15),
        [],
      ),
      withQueryFallback(
        "credit_card_instruments",
        input.supabase.from("credit_cards")
          .select("bank_connection_id,credit_card_instruments(id)")
          .eq("owner_id", input.userId).eq("source", "pluggy"),
        [],
      ),
      withQueryFallback(
        "card_sync_metrics",
        input.supabase.from("card_purchases").select("bank_connection_id")
          .eq("owner_id", input.userId).eq("source", "pluggy")
          .eq("instrument_review_status", "pending"),
        [],
      ),
      withQueryFallback(
        "card_sync_diagnostics",
        input.supabase.from("credit_card_sync_diagnostics")
          .select("id,card_id,received_from_pluggy,mapped,persisted,included_in_invoice,excluded_from_invoice,pages,created_at,credit_cards(name,last_four_digits)")
          .eq("owner_id", input.userId).order("created_at", { ascending: false })
          .limit(8),
        [],
      ),
      withQueryFallback(
        "financial_resource_sync_status",
        input.supabase.from("financial_resource_sync_status")
          .select("id,bank_connection_id,sync_run_id,resource_type,entity_type,provider_entity_id,local_entity_id,status,data_freshness,last_attempt_at,last_successful_sync_at,records_received,records_inserted,records_updated,records_preserved,error_code,error_message_safe,retryable,metadata")
          .eq("owner_id", input.userId).order("created_at", { ascending: false })
          .limit(120),
        [],
      ),
      withQueryFallback(
        "automatic_pluggy_sync",
        input.supabase.from("bank_connections").select("id,automatic_sync_enabled")
          .eq("owner_id", input.userId).eq("provider", "pluggy")
          .neq("status", "disabled"),
        [],
      ),
      withQueryFallback(
        "pluggy_account_freshness",
        input.supabase.from("financial_accounts")
          .select("id,last_accounts_sync_at,last_transactions_sync_at,last_balance_sync_at,last_transaction_date")
          .eq("owner_id", input.userId).eq("source", "pluggy"),
        [],
      ),
    ]);

  const diagnostics = new Map<string, { creditAccounts: number; instruments: number; pending: number }>();
  const ensureDiagnostic = (id: string) => diagnostics.get(id) ?? {
    creditAccounts: 0,
    instruments: 0,
    pending: 0,
  };
  for (const row of creditProducts.data) {
    const id = String(row.bank_connection_id);
    if (!connectionIds.includes(id)) continue;
    const current = ensureDiagnostic(id);
    current.creditAccounts += 1;
    current.instruments += Array.isArray(row.credit_card_instruments)
      ? row.credit_card_instruments.length
      : 0;
    diagnostics.set(id, current);
  }
  for (const row of pending.data) {
    const id = String(row.bank_connection_id);
    if (!connectionIds.includes(id)) continue;
    const current = ensureDiagnostic(id);
    current.pending += 1;
    diagnostics.set(id, current);
  }

  const healthByConnection = new Map(health.data.map(row => [String(row.id), row]));
  const automaticByConnection = new Map(
    automatic.data.map(row => [String(row.id), Boolean(row.automatic_sync_enabled)]),
  );
  const connections: IntegrationConnectionInput[] = connectionRows.map(row => {
    const providerHealth = healthByConnection.get(String(row.id));
    return {
      id: String(row.id),
      connectorName: row.connector_name ? String(row.connector_name) : null,
      status: String(row.status),
      syncStatus: String(row.sync_status),
      automaticSyncEnabled: automaticByConnection.get(String(row.id)) ?? false,
      lastProviderUpdateAt: row.last_provider_update_at ? String(row.last_provider_update_at) : null,
      lastSuccessfulSyncAt: row.last_successful_sync_at ? String(row.last_successful_sync_at) : null,
      lastCompleteSyncAt: providerHealth?.last_complete_sync_at ? String(providerHealth.last_complete_sync_at) : null,
      lastSyncAt: providerHealth?.last_sync_at ? String(providerHealth.last_sync_at) : null,
      providerStatus: providerHealth?.provider_status ? String(providerHealth.provider_status) : "waiting",
      dataCompleteness: providerHealth?.data_completeness ? String(providerHealth.data_completeness) : "unknown",
      incidentMessage: providerHealth?.incident_message ? String(providerHealth.incident_message) : null,
      staleSince: providerHealth?.stale_since ? String(providerHealth.stale_since) : null,
      connectionErrorMessage: row.connection_error_message ? String(row.connection_error_message) : null,
      maskedItem: mask(String(row.provider_connection_id)),
      diagnostics: diagnostics.get(String(row.id)) ?? ensureDiagnostic(String(row.id)),
    };
  });
  const runs: RecentSyncActivity[] = history.data
    .filter(row => connectionIds.includes(String(row.bank_connection_id)))
    .map(row => ({
      id: String(row.id),
      connectionId: String(row.bank_connection_id),
      status: String(row.status),
      triggerType: String(row.trigger_type ?? "manual"),
      startedAt: String(row.started_at),
      completedAt: row.completed_at ? String(row.completed_at) : null,
      durationMs: row.completed_at
        ? Math.max(0, new Date(String(row.completed_at)).getTime() - new Date(String(row.started_at)).getTime())
        : null,
      resourcesSucceeded: Number(row.resources_succeeded ?? 0),
      resourcesFailed: Number(row.resources_failed ?? 0),
      resourcesPreserved: Number(row.resources_preserved ?? 0),
      recordsInserted: Number(row.records_inserted ?? 0),
      recordsUpdated: Number(row.records_updated ?? 0),
      recordsPreserved: Number(row.records_preserved ?? 0),
      warningCodes: Array.isArray(row.warning_codes) ? row.warning_codes.map(String) : [],
      errorCode: row.error_code ? String(row.error_code) : null,
      safeMessage: row.error_message ? String(row.error_message) : null,
    }));
  const accountFreshnessById = new Map(accountFreshness.data.map(row => [String(row.id), row]));
  const resources: IntegrationResourceInput[] = resourceRows.data
    .filter(row => connectionIds.includes(String(row.bank_connection_id)))
    .map(row => ({
      id: String(row.id),
      connectionId: String(row.bank_connection_id),
      syncRunId: String(row.sync_run_id),
      resourceType: String(row.resource_type),
      entityType: row.entity_type ? String(row.entity_type) : null,
      providerEntityId: String(row.provider_entity_id),
      status: String(row.status),
      dataFreshness: String(row.data_freshness),
      lastAttemptAt: row.last_attempt_at ? String(row.last_attempt_at) : null,
      lastSuccessfulSyncAt: row.last_successful_sync_at ? String(row.last_successful_sync_at) : null,
      received: Number(row.records_received ?? 0),
      inserted: Number(row.records_inserted ?? 0),
      updated: Number(row.records_updated ?? 0),
      preserved: Number(row.records_preserved ?? 0),
      safeMessage: row.error_message_safe
        ? String(row.error_message_safe)
        : row.error_code
          ? `A atualização deste recurso não foi concluída; os dados anteriores foram preservados. (${String(row.error_code)})`
          : null,
      errorCode: row.error_code ? String(row.error_code) : null,
      retryable: Boolean(row.retryable),
      metadata: {
        ...(row.metadata && typeof row.metadata === "object"
          ? row.metadata as Record<string, unknown>
          : {}),
        ...(row.local_entity_id && accountFreshnessById.has(String(row.local_entity_id))
          ? accountFreshnessById.get(String(row.local_entity_id))
          : {}),
      },
    }));
  const cardDiagnostics: AdvancedCardDiagnostic[] = cardRows.data.map(row => ({
    id: String(row.id),
    name: String((row.credit_cards as unknown as { name?: string } | null)?.name ?? "Cartão"),
    lastFour: String((row.credit_cards as unknown as { last_four_digits?: string } | null)?.last_four_digits ?? "••••"),
    received: Number(row.received_from_pluggy ?? 0),
    mapped: Number(row.mapped ?? 0),
    persisted: Number(row.persisted ?? 0),
    included: Number(row.included_in_invoice ?? 0),
    excluded: Number(row.excluded_from_invoice ?? 0),
    pages: Number(row.pages ?? 0),
  }));

  return buildFinanceIntegrationsDashboard({
    configured: getPluggyConfigurationStatus().configured,
    connections,
    resources,
    runs,
    cardDiagnostics,
    warnings: {
      providerHealth: Boolean(health.warning),
      history: Boolean(history.warning),
      instruments: Boolean(creditProducts.warning || pending.warning),
      cardDiagnostics: Boolean(cardRows.warning),
      resourceHistory: Boolean(resourceRows.warning),
      automaticSync: Boolean(automatic.warning),
    },
  });
}
