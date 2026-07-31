import { PluggyIntegrationPanel } from "@/components/finance/pluggy-integration-panel";
import { getPluggyConfigurationStatus } from "@/lib/pluggy/client";
import {
  requireQuery,
  withQueryFallback,
} from "@/lib/supabase/query-fallback";
import { requireFinanceAccess } from "@/modules/finance/access";

const mask = (value: string) =>
  value.length < 8 ? "••••" : `${value.slice(0, 4)}…${value.slice(-4)}`;

export default async function Page() {
  const { supabase, user } = await requireFinanceAccess();

  // Keep the required query limited to the stable schema introduced with Pluggy.
  // Provider-health fields are loaded separately so a pending resilience migration
  // cannot make the whole integrations page unavailable.
  const connectionRows = await requireQuery(
    "bank_connections",
    supabase
      .from("bank_connections")
      .select(
        "id,provider_connection_id,connector_name,status,sync_status,last_provider_update_at,last_successful_sync_at,connection_error_message",
      )
      .eq("owner_id", user.id)
      .eq("provider", "pluggy")
      .neq("status", "disabled")
      .order("created_at", { ascending: false }),
  );

  const [
    health,
    history,
    creditProducts,
    pending,
    syncDiagnostics,
    resourceHistory,
    automaticSync,
  ] =
    await Promise.all([
      withQueryFallback(
        "provider_incidents",
        supabase
          .from("bank_connections")
          .select(
            "id,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count",
          )
          .eq("owner_id", user.id)
          .eq("provider", "pluggy")
          .neq("status", "disabled"),
        [],
      ),
      withQueryFallback(
        "financial_sync_runs",
        supabase
          .from("financial_sync_runs")
          .select(
            "id,bank_connection_id,status,trigger_type,started_at,completed_at,accounts_count,cards_count,transactions_count,investments_count,loans_count,resources_succeeded,resources_failed,resources_preserved,records_inserted,records_updated,records_preserved,warning_codes",
          )
          .eq("owner_id", user.id)
          .order("started_at", { ascending: false })
          .limit(30),
        [],
      ),
      withQueryFallback(
        "credit_card_instruments",
        supabase
          .from("credit_cards")
          .select("bank_connection_id,credit_card_instruments(id)")
          .eq("owner_id", user.id)
          .eq("source", "pluggy"),
        [],
      ),
      withQueryFallback(
        "card_sync_metrics",
        supabase
          .from("card_purchases")
          .select("bank_connection_id")
          .eq("owner_id", user.id)
          .eq("source", "pluggy")
          .eq("instrument_review_status", "pending"),
        [],
      ),
      withQueryFallback(
        "card_sync_diagnostics",
        supabase
          .from("credit_card_sync_diagnostics")
          .select(
            "id,card_id,received_from_pluggy,mapped,persisted,included_in_invoice,excluded_from_invoice,pages,page_sizes,status_counts,classification_counts,reference_counts,instrument_counts,exclusion_counts,created_at,credit_cards(name,last_four_digits,brand)",
          )
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(12),
        [],
      ),
      withQueryFallback(
        "financial_resource_sync_status",
        supabase
          .from("financial_resource_sync_status")
          .select(
            "id,bank_connection_id,sync_run_id,resource_type,entity_type,provider_entity_id,local_entity_id,status,data_freshness,last_attempt_at,last_successful_sync_at,records_received,records_inserted,records_updated,records_unchanged,records_preserved,error_code,warning_codes,retryable,next_retry_at,metadata",
          )
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(200),
        [],
      ),
      withQueryFallback(
        "automatic_pluggy_sync",
        supabase
          .from("bank_connections")
          .select("id,automatic_sync_enabled")
          .eq("owner_id", user.id)
          .eq("provider", "pluggy")
          .neq("status", "disabled"),
        [],
      ),
    ]);

  const diagnostics = new Map<
    string,
    { creditAccounts: number; instruments: number; pending: number }
  >();

  for (const row of creditProducts.data) {
    const key = String(row.bank_connection_id);
    const current = diagnostics.get(key) ?? {
      creditAccounts: 0,
      instruments: 0,
      pending: 0,
    };
    current.creditAccounts += 1;
    current.instruments += Array.isArray(row.credit_card_instruments)
      ? row.credit_card_instruments.length
      : 0;
    diagnostics.set(key, current);
  }

  for (const row of pending.data) {
    const key = String(row.bank_connection_id);
    const current = diagnostics.get(key) ?? {
      creditAccounts: 0,
      instruments: 0,
      pending: 0,
    };
    current.pending += 1;
    diagnostics.set(key, current);
  }

  const healthByConnection = new Map(
    health.data.map((row) => [String(row.id), row]),
  );
  const automaticSyncByConnection = new Map(
    automaticSync.data.map(row => [
      String(row.id),
      Boolean(row.automatic_sync_enabled),
    ]),
  );

  const connections = connectionRows.map((row) => {
    const providerHealth = healthByConnection.get(String(row.id));
    return {
      id: String(row.id),
      connector_name: row.connector_name ? String(row.connector_name) : null,
      status: String(row.status),
      sync_status: String(row.sync_status),
      automatic_sync_enabled:
        automaticSyncByConnection.get(String(row.id)) ?? false,
      last_provider_update_at: row.last_provider_update_at
        ? String(row.last_provider_update_at)
        : null,
      last_successful_sync_at: row.last_successful_sync_at
        ? String(row.last_successful_sync_at)
        : null,
      last_complete_sync_at: providerHealth?.last_complete_sync_at
        ? String(providerHealth.last_complete_sync_at)
        : null,
      last_sync_at: providerHealth?.last_sync_at
        ? String(providerHealth.last_sync_at)
        : null,
      provider_status: providerHealth?.provider_status
        ? String(providerHealth.provider_status)
        : "waiting",
      data_completeness: providerHealth?.data_completeness
        ? String(providerHealth.data_completeness)
        : "unknown",
      incident_message: providerHealth?.incident_message
        ? String(providerHealth.incident_message)
        : null,
      stale_since: providerHealth?.stale_since
        ? String(providerHealth.stale_since)
        : null,
      partial_data_count: Number(providerHealth?.partial_data_count ?? 0),
      connection_error_message: row.connection_error_message
        ? String(row.connection_error_message)
        : null,
      maskedItem: mask(String(row.provider_connection_id)),
      diagnostics: diagnostics.get(String(row.id)) ?? {
        creditAccounts: 0,
        instruments: 0,
        pending: 0,
      },
      resourceStatuses: resourceHistory.data
        .filter((resource) => String(resource.bank_connection_id) === String(row.id))
        .map((resource) => ({
          id: String(resource.id),
          syncRunId: String(resource.sync_run_id),
          resourceType: String(resource.resource_type),
          entityType: resource.entity_type ? String(resource.entity_type) : null,
          providerEntityId: String(resource.provider_entity_id),
          status: String(resource.status),
          dataFreshness: String(resource.data_freshness),
          lastAttemptAt: String(resource.last_attempt_at),
          lastSuccessfulSyncAt: resource.last_successful_sync_at
            ? String(resource.last_successful_sync_at)
            : null,
          received: Number(resource.records_received),
          inserted: Number(resource.records_inserted),
          updated: Number(resource.records_updated),
          unchanged: Number(resource.records_unchanged),
          preserved: Number(resource.records_preserved),
          errorCode: resource.error_code ? String(resource.error_code) : null,
          warningCodes: Array.isArray(resource.warning_codes)
            ? resource.warning_codes.map(String)
            : [],
          retryable: Boolean(resource.retryable),
          nextRetryAt: resource.next_retry_at
            ? String(resource.next_retry_at)
            : null,
          metadata:
            resource.metadata && typeof resource.metadata === "object"
              ? (resource.metadata as Record<string, unknown>)
              : {},
        })),
    };
  });

  const runs = history.data.map((row) => ({
    id: String(row.id),
    bank_connection_id: String(row.bank_connection_id),
    status: String(row.status),
    trigger_type: String(row.trigger_type ?? "manual"),
    started_at: String(row.started_at),
    completed_at: row.completed_at ? String(row.completed_at) : null,
    accounts_count: Number(row.accounts_count),
    cards_count: Number(row.cards_count),
    transactions_count: Number(row.transactions_count),
    investments_count: Number(row.investments_count),
    loans_count: Number(row.loans_count),
    resources_succeeded: Number(row.resources_succeeded ?? 0),
    resources_failed: Number(row.resources_failed ?? 0),
    resources_preserved: Number(row.resources_preserved ?? 0),
    records_inserted: Number(row.records_inserted ?? 0),
    records_updated: Number(row.records_updated ?? 0),
    records_preserved: Number(row.records_preserved ?? 0),
    warning_codes: Array.isArray(row.warning_codes)
      ? row.warning_codes.map(String)
      : [],
  }));

  const cardDiagnostics = syncDiagnostics.data.map((row) => ({
    id: String(row.id),
    cardId: String(row.card_id),
    name: String(
      (row.credit_cards as unknown as { name?: string } | null)?.name ??
        "Cartão",
    ),
    lastFour: String(
      (
        row.credit_cards as unknown as {
          last_four_digits?: string;
        } | null
      )?.last_four_digits ?? "••••",
    ),
    received: Number(row.received_from_pluggy),
    mapped: Number(row.mapped),
    persisted: Number(row.persisted),
    included: Number(row.included_in_invoice),
    excluded: Number(row.excluded_from_invoice),
    pages: Number(row.pages),
    pageSizes: row.page_sizes as number[],
    statusCounts: row.status_counts as Record<string, number>,
    classificationCounts: row.classification_counts as Record<string, number>,
    referenceCounts: row.reference_counts as Record<string, number>,
    instrumentCounts: row.instrument_counts as Record<string, number>,
    exclusionCounts: row.exclusion_counts as Record<string, number>,
    createdAt: String(row.created_at),
  }));

  return (
    <PluggyIntegrationPanel
      configured={getPluggyConfigurationStatus().configured}
      connections={connections}
      runs={runs}
      cardDiagnostics={cardDiagnostics}
      warnings={{
        providerHealth: Boolean(health.warning),
        history: Boolean(history.warning),
        instruments: Boolean(creditProducts.warning || pending.warning),
        cardDiagnostics: Boolean(syncDiagnostics.warning),
        resourceHistory: Boolean(resourceHistory.warning),
        automaticSync: Boolean(automaticSync.warning),
      }}
    />
  );
}

export const maxDuration = 60;
