import { FinanceIntegrationsDashboard } from "@/components/finance/pluggy-integration-panel";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getFinanceIntegrationsDashboard } from "@/modules/finance/integrations-dashboard-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string | string[] }>;
}) {
  const { supabase, user } = await requireFinanceAccess();
  const params = await searchParams;
  const requestedWorkspace = typeof params.workspace === "string"
    ? params.workspace
    : null;
  const workspaceId = requestedWorkspace && UUID.test(requestedWorkspace)
    ? requestedWorkspace
    : null;
  const dashboard = await getFinanceIntegrationsDashboard({
    supabase,
    userId: user.id,
    workspaceId,
  });

  return <FinanceIntegrationsDashboard dashboard={dashboard} />;
}

export const maxDuration = 60;
