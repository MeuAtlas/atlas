import { FinanceShell } from "@/components/finance/finance-shell";
import {
  ProviderHealthAlerts,
  type ProviderHealth,
} from "@/components/finance/provider-health-alert";
import { withQueryFallback } from "@/lib/supabase/query-fallback";
import {
  getFinanceShellData,
  requireFinanceAccess,
} from "@/modules/finance/access";

export const dynamic = "force-dynamic";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await requireFinanceAccess();
  const [shellData, health] = await Promise.all([
    getFinanceShellData(access),
    withQueryFallback(
    "finance_provider_health",
    access.supabase
      .from("bank_connections")
      .select(
        "id,connector_name,provider_status,data_completeness,sync_status,last_sync_at,last_complete_sync_at,stale_since,partial_data_count",
      )
      .eq("owner_id", access.user.id)
      .eq("provider", "pluggy")
      .neq("status", "disabled"),
      [],
    ),
  ]);
  const connections = health.data.map(
    (row) =>
      ({
        id: String(row.id),
        connectorName: row.connector_name
          ? String(row.connector_name)
          : null,
        providerStatus: String(row.provider_status),
        dataCompleteness: String(row.data_completeness),
        syncStatus: String(row.sync_status),
        lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
        lastCompleteSyncAt: row.last_complete_sync_at
          ? String(row.last_complete_sync_at)
          : null,
        incidentStartedAt: row.stale_since ? String(row.stale_since) : null,
        partialDataCount: Number(row.partial_data_count ?? 0),
      }) satisfies ProviderHealth,
  );

  return (
    <FinanceShell
      profile={access.profile}
      workspaces={shellData.workspaces}
      modules={shellData.modules}
    >
      <ProviderHealthAlerts connections={connections} />
      {children}
    </FinanceShell>
  );
}
