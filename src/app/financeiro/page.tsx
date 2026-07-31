import { FinanceOverview } from "@/components/finance/finance-overview";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getFinanceOverviewDashboard } from "@/modules/finance/finance-overview-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string | string[];
    account?: string | string[];
    workspace?: string | string[];
  }>;
}) {
  const { supabase, user, profile } = await requireFinanceAccess();
  const params = await searchParams;
  const workspaceParam = typeof params.workspace === "string" ? params.workspace : undefined;
  const workspaceId = workspaceParam && UUID.test(workspaceParam) ? workspaceParam : null;
  const timeZone = profile.timezone || "America/Sao_Paulo";
  const result = await getFinanceOverviewDashboard({
    supabase,
    userId: user.id,
    selectedMonth: typeof params.month === "string" ? params.month : undefined,
    selectedAccountId: typeof params.account === "string" ? params.account : undefined,
    workspaceId,
    timeZone,
  });
  return (
    <FinanceOverview
      dashboard={result.dashboard}
      accounts={result.accounts}
      selectedAccountId={result.selectedAccountId}
      selectedMonth={result.period.key}
      maximumMonth={result.maximumMonth}
      name={profile.preferred_name || profile.full_name || "você"}
      timeZone={timeZone}
      workspace={workspaceParam || "personal"}
    />
  );
}
