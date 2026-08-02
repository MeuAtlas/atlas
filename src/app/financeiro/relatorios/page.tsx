import Link from "next/link";

import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { ClientSearchForm } from "@/components/navigation/client-navigation";
import { AtlasText } from "@/components/ui/atlas-text";
import { getFinancialMonths, getMonthlyReportPreview, getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";
import { configureFinancialTrackingStart } from "./actions";

const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const statusLabel: Record<string, string> = { open: "Em andamento", awaiting_consolidation: "Aguardando consolidação", review: "Pronto para revisão", closing: "Concluindo mês", closed: "Concluído", reopened: "Reaberto para correção" };
const actionLabel: Record<string, string> = { open: "Acompanhar", awaiting_consolidation: "Acompanhar", review: "Revisar e concluir", closing: "Acompanhar", closed: "Ver relatório", reopened: "Continuar correção" };

function currentReport(row: Record<string, unknown>) {
  const value = row.monthly_financial_reports;
  return (Array.isArray(value) ? value[0] : value) as { snapshot_json?: { totals?: Record<string, number> } } | null;
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ workspace?: string; year?: string; profile?: string; account?: string; person?: string; view?: string }> }) {
  const params = await searchParams;
  const context = await getReadableFinanceWorkspace(params.workspace, { fallbackToPersonal: true });
  const currentYear = new Date().getFullYear();
  const requestedYear = /^\d{4}$/.test(params.year ?? "") ? Number(params.year) : currentYear;
  const year = Math.min(currentYear, Math.max(context.tracking.startYear, requestedYear));
  const months = await getFinancialMonths({ supabase: context.supabase, workspaceId: context.workspaceId, year, tracking: context.tracking, canCreate: context.canAdmin });
  const previewEntries = await Promise.all(months.map(async (raw) => {
    const row = raw as unknown as Record<string, unknown>;
    const month = Number(row.reference_month);
    const report = currentReport(row);
    if (String(row.status) === "closed" && report?.snapshot_json?.totals?.forecastCardInvoice != null) {
      return [month, report.snapshot_json] as const;
    }
    const preview = await getMonthlyReportPreview({
      supabase: context.supabase,
      workspaceId: context.workspaceId,
      year,
      month,
      tracking: context.tracking,
      canCreate: context.canAdmin,
      ownerId: context.user.id,
      includeOwnerPrivateData: context.includeOwnerPrivateData,
    });
    return [month, preview.snapshot] as const;
  }));
  const previews = new Map(previewEntries);
  const preserved = new URLSearchParams({ workspace: context.workspaceId });
  for (const key of ["profile", "account", "person", "view"] as const) if (params[key]) preserved.set(key, params[key]);
  return (
    <ValueVisibility controls={false}>
      <main className="monthly-reports reports-page">
        <header className="monthly-page-head">
          <div><AtlasText variant="label">Sua história financeira</AtlasText><AtlasText variant="pageTitle">Relatórios financeiros</AtlasText><AtlasText variant="pageSubtitle">Acompanhe cada mês e guarde uma visão clara da sua vida financeira.</AtlasText></div>
          <div className="monthly-head-actions"><Link href={`/financeiro/relatorios/analises?${preserved.toString()}`} prefetch={false}><AtlasText variant="button">Análises por período</AtlasText></Link><ClientSearchForm action="/financeiro/relatorios" history="replace" className="monthly-year-filter">
            <input type="hidden" name="workspace" value={context.workspaceId} />
            {(["profile", "account", "person", "view"] as const).map((key) => params[key] ? <input key={key} type="hidden" name={key} value={params[key]} /> : null)}
            <label><AtlasText variant="formLabel">Ano</AtlasText><select name="year" defaultValue={year}>{Array.from({ length: currentYear - context.tracking.startYear + 1 }, (_, index) => currentYear - index).map((item) => <option key={item}>{item}</option>)}</select></label>
            <button className="finance-button"><AtlasText variant="button">Mostrar</AtlasText></button>
          </ClientSearchForm></div>
        </header>
        <div className="monthly-tracking-note"><AtlasText as="span" variant="secondary">Acompanhamento iniciado em {new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Fortaleza" }).format(new Date(context.tracking.startedAt))}. Meses anteriores não são criados automaticamente.</AtlasText>{context.canAdmin && !months.some((month) => String(month.status) === "closed") ? <details><summary><AtlasText as="span" variant="button">Alterar mês inicial</AtlasText></summary><form action={configureFinancialTrackingStart}><input type="hidden" name="workspace_id" value={context.workspaceId} /><label><AtlasText variant="formLabel">A partir de qual mês você quer acompanhar suas finanças?</AtlasText><input type="month" name="tracking_month" required defaultValue={`${context.tracking.startYear}-${String(context.tracking.startMonth).padStart(2, "0")}`} max={`${currentYear}-${String(new Date().getMonth() + 1).padStart(2, "0")}`} /></label><button className="finance-button secondary"><AtlasText variant="button">Salvar início</AtlasText></button></form></details> : null}</div>
        <section className="monthly-list finance-panel" aria-label={`Relatórios de ${year}`}>
          <div className="monthly-list-head">{["Mês", "Situação", "Resultado em caixa", "Consumo pessoal", "Saldo final", "Fatura prevista"].map((label) => <AtlasText variant="tableHeader" key={label}>{label}</AtlasText>)}<span /></div>
          {months.map((raw) => {
            const row = raw as unknown as Record<string, unknown>;
            const month = Number(row.reference_month);
            const status = String(row.status);
            const report = currentReport(row);
            const totals = previews.get(month)?.totals ?? report?.snapshot_json?.totals;
            const href = `/financeiro/relatorios/${year}/${String(month).padStart(2, "0")}?${preserved.toString()}`;
            return <article className="monthly-list-row" key={month}>
              <AtlasText as="strong" variant="tableBody">{names[month - 1]}</AtlasText>
              <AtlasText as="span" variant="tableBody"><i className={`monthly-status ${status}`} />{statusLabel[status] ?? status}</AtlasText>
              <AtlasText as="span" variant="financialValueSmall" data-label="Resultado"><Money value={totals?.cashResult ?? 0} /></AtlasText>
              <AtlasText as="span" variant="financialValueSmall" data-label="Consumo"><Money value={totals?.personalConsumption ?? 0} /></AtlasText>
              <AtlasText as="span" variant="financialValueSmall" data-label="Saldo final"><Money value={totals?.closingBalance ?? 0} /></AtlasText>
              <AtlasText as="span" variant="financialValueSmall" data-label="Fatura prevista"><Money value={totals?.forecastCardInvoice ?? 0} /></AtlasText>
              <Link href={href} prefetch={false}><AtlasText variant="button">{actionLabel[status] ?? "Abrir"}</AtlasText></Link>
            </article>;
          })}
        </section>
      </main>
    </ValueVisibility>
  );
}
