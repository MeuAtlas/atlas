import Link from "next/link";

import { ActiveFinancialMonths, ClosedFinancialReports } from "@/components/finance/financial-reports-list";
import { ValueVisibility } from "@/components/finance/value-visibility";
import { ClientSearchForm } from "@/components/navigation/client-navigation";
import { AtlasText } from "@/components/ui/atlas-text";
import { getFinancialReportsPageData } from "@/modules/finance/financial-reports-list-query";
import { getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";
import { configureFinancialTrackingStart } from "./actions";

type ReportSearchParams = {
  workspace?: string;
  year?: string;
  financialProfile?: string;
  profile?: string;
  account?: string;
  person?: string;
  view?: string;
};

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportSearchParams> }) {
  const params = await searchParams;
  const context = await getReadableFinanceWorkspace(params.workspace, { fallbackToPersonal: !params.workspace });
  const currentYear = new Date().getFullYear();
  const requestedYear = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : currentYear;
  const historyYear = Math.min(currentYear, Math.max(context.tracking.startYear, requestedYear));
  const data = await getFinancialReportsPageData({
    supabase: context.supabase,
    workspaceId: context.workspaceId,
    tracking: context.tracking,
    canCreate: context.canAdmin,
    ownerId: context.user.id,
    includeOwnerPrivateData: context.includeOwnerPrivateData,
    historyYear,
  });
  const preserved = new URLSearchParams({ workspace: context.workspaceId });
  for (const key of ["financialProfile", "profile", "account", "person", "view"] as const) {
    if (params[key]) preserved.set(key, params[key]);
  }
  const detailHref = (year: number, month: number) =>
    `/financeiro/relatorios/${year}/${String(month).padStart(2, "0")}?${preserved.toString()}`;

  return <ValueVisibility controls={false}><main className="monthly-reports reports-page">
    <header className="monthly-page-head"><div><AtlasText variant="label">Sua história financeira</AtlasText><AtlasText variant="pageTitle">Relatórios financeiros</AtlasText><AtlasText variant="pageSubtitle">Veja o que precisa de atenção agora e consulte fechamentos preservados no histórico.</AtlasText></div><div className="monthly-head-actions"><Link href={`/financeiro/relatorios/analises?${preserved.toString()}`} prefetch={false}><AtlasText variant="button">Análises por período</AtlasText></Link><ClientSearchForm action="/financeiro/relatorios" history="replace" className="monthly-year-filter"><input type="hidden" name="workspace" value={context.workspaceId} />{(["financialProfile", "profile", "account", "person", "view"] as const).map(key => params[key] ? <input key={key} type="hidden" name={key} value={params[key]} /> : null)}<label><AtlasText variant="formLabel">Ano do histórico</AtlasText><select name="year" defaultValue={historyYear}>{Array.from({ length: currentYear - context.tracking.startYear + 1 }, (_, index) => currentYear - index).map(year => <option key={year}>{year}</option>)}</select></label><button className="finance-button"><AtlasText variant="button">Mostrar</AtlasText></button></ClientSearchForm></div></header>
    <div className="monthly-tracking-note"><AtlasText as="span" variant="secondary">Acompanhamento iniciado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Fortaleza" }).format(new Date(context.tracking.startedAt))}. Meses concluídos permanecem preservados.</AtlasText>{context.canAdmin && data.closedTotal === 0 ? <details><summary><AtlasText as="span" variant="button">Alterar mês inicial</AtlasText></summary><form action={configureFinancialTrackingStart}><input type="hidden" name="workspace_id" value={context.workspaceId} /><label><AtlasText variant="formLabel">A partir de qual mês você quer acompanhar suas finanças?</AtlasText><input type="month" name="tracking_month" required defaultValue={`${context.tracking.startYear}-${String(context.tracking.startMonth).padStart(2, "0")}`} max={`${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`} /></label><button className="finance-button secondary"><AtlasText variant="button">Salvar início</AtlasText></button></form></details> : null}</div>
    <ActiveFinancialMonths items={data.active} hrefFor={item => detailHref(item.month.reference_year, item.month.reference_month)} />
    <ClosedFinancialReports items={data.closed} total={data.closedTotal} hrefFor={item => detailHref(item.month.reference_year, item.month.reference_month)} />
  </main></ValueVisibility>;
}
