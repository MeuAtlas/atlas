import { PlanningDashboardView } from "@/components/finance/planning-dashboard";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  getPlanningDashboard,
  shiftPlanningMonth,
} from "@/modules/finance/planning-dashboard-query";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string | string[];
    month?: string | string[];
    horizon?: string | string[];
    account?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const { supabase, user, profile } = await requireFinanceAccess();
  const workspacesResult = await supabase.from("workspaces")
    .select("id,name,type").order("type");
  if (workspacesResult.error) throw new Error("Não foi possível carregar o espaço financeiro.");
  const requestedWorkspace = typeof params.workspace === "string" ? params.workspace : null;
  const workspace = workspacesResult.data?.find(item => item.id === requestedWorkspace)
    ?? workspacesResult.data?.[0];
  if (!workspace) throw new Error("Nenhum espaço financeiro disponível.");

  const timeZone = profile.timezone || "America/Sao_Paulo";
  const currentMonth = new Date().toLocaleDateString("en-CA", {
    year: "numeric", month: "2-digit", timeZone,
  }).slice(0, 7);
  const defaultMonth = shiftPlanningMonth(currentMonth, 1);
  const maximumMonth = shiftPlanningMonth(currentMonth, 11);
  const requestedMonth = typeof params.month === "string" && /^\d{4}-\d{2}$/.test(params.month)
    ? params.month
    : defaultMonth;
  const startMonth = requestedMonth < currentMonth
    ? currentMonth
    : requestedMonth > maximumMonth ? maximumMonth : requestedMonth;
  const requestedHorizon = typeof params.horizon === "string" ? Number(params.horizon) : 6;
  const horizon = ([3, 6, 12].includes(requestedHorizon) ? requestedHorizon : 6) as 3 | 6 | 12;
  const requestedAccount = typeof params.account === "string" && params.account !== "all" && UUID.test(params.account)
    ? params.account
    : null;
  const dashboard = await getPlanningDashboard({
    supabase,
    userId: user.id,
    workspaceId: String(workspace.id),
    startMonth,
    horizon,
    accountId: requestedAccount,
    timeZone,
  });
  return <PlanningDashboardView dashboard={dashboard} />;
}
