import Link from "next/link";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { ClientSearchForm } from "@/components/navigation/client-navigation";
import { getPersonFinancialSummary } from "@/modules/finance/commitments-query";
import { getIncomeExpenseOverview } from "@/modules/finance/income-expenses-query";
import { getPersonPixSummary } from "@/modules/finance/person-reimbursements-query";
import { getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";

export default async function FinancialAnalysisPage({ searchParams }: { searchParams: Promise<{ workspace?: string; person?: string; category?: string; commitment?: string; kind?: string; from?: string; to?: string }> }) {
  const params = await searchParams;
  const context = await getReadableFinanceWorkspace(params.workspace, { fallbackToPersonal: true });
  const today = new Date();
  const from = params.from ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
  const to = params.to ?? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const [people, categories, commitments] = await Promise.all([
    context.supabase.from("financial_people").select("id,name").eq("workspace_id", context.workspaceId).neq("relation_type", "self").is("archived_at", null).order("name"),
    context.supabase.from("financial_categories").select("id,name").order("name"),
    context.supabase.from("financial_commitments").select("id,title").eq("workspace_id", context.workspaceId).is("archived_at", null).order("title"),
  ]);
  const selected = people.data?.find((item) => item.id === params.person);
  const [summary, pix, flow] = await Promise.all([
    selected ? getPersonFinancialSummary(context.supabase, { workspaceId: context.workspaceId, personId: selected.id, from, to }) : Promise.resolve(null),
    selected ? getPersonPixSummary(context.supabase, { workspaceId: context.workspaceId, personId: selected.id, from, to }) : Promise.resolve(null),
    getIncomeExpenseOverview(context.supabase, { workspaceId: context.workspaceId, month: to.slice(0, 7) }),
  ]);
  return <ValueVisibility controls={false}><main className="reports-page">
    <header className="monthly-report-header"><div><Link href={`/financeiro/relatorios?workspace=${context.workspaceId}`} prefetch={false}>← Fechamentos mensais</Link><p className="eyebrow">Análise financeira</p><h1>Análises por período</h1><p>Compare receitas, despesas, pessoas e reembolsos sem alterar os fechamentos salvos.</p></div></header>
    <ClientSearchForm action="/financeiro/relatorios/analises" className="finance-panel report-filters"><input type="hidden" name="workspace" value={context.workspaceId} />
      <label>Pessoa<select name="person" defaultValue={params.person ?? ""}><option value="">Todas</option>{(people.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Categoria<select name="category" defaultValue={params.category ?? ""}><option value="">Todas</option>{(categories.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Receita ou despesa<select name="commitment" defaultValue={params.commitment ?? ""}><option value="">Todos</option>{(commitments.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Natureza<select name="kind" defaultValue={params.kind ?? ""}><option value="">Todas</option><option value="recurring">Recorrente</option><option value="extraordinary">Extraordinário</option></select></label>
      <label>De<input name="from" type="date" defaultValue={from} /></label><label>Até<input name="to" type="date" defaultValue={to} /></label><button className="finance-button">Aplicar filtros</button>
    </ClientSearchForm>
    <section className="commitment-summary-grid report-summary"><article><span>Receitas esperadas</span><strong className="positive"><Money value={flow.overview.expectedIncomeCents / 100} /></strong></article><article><span>Receitas realizadas</span><strong className="positive"><Money value={flow.overview.receivedIncomeCents / 100} /></strong></article><article><span>Despesas previstas</span><strong><Money value={flow.overview.expectedExpenseCents / 100} /></strong></article><article><span>Despesas realizadas</span><strong><Money value={flow.overview.paidExpenseCents / 100} /></strong></article><article><span>Resultado realizado</span><strong><Money value={flow.overview.realizedBalanceCents / 100} /></strong></article><article><span>Planejamento</span><strong><Money value={flow.overview.projectedBalanceCents / 100} /></strong></article></section>
    {summary ? <><section className="commitment-summary-grid report-summary"><article><span>Total atribuído</span><strong><Money value={summary.totalSpentCents / 100} /></strong></article><article><span>Realizado</span><strong><Money value={summary.actualSpentCents / 100} /></strong></article><article><span>Média mensal</span><strong><Money value={summary.averageMonthlyCents / 100} /></strong></article><article><span>Custo líquido</span><strong><Money value={pix?.netUserCost ?? 0} /></strong></article><article><span>Reembolsado</span><strong className="positive"><Money value={pix?.reimbursedAmount ?? 0} /></strong></article><article><span>Reembolso pendente</span><strong><Money value={pix?.pendingReimbursementAmount ?? 0} /></strong></article></section><div className="report-grid"><section className="finance-panel"><header><div><p className="eyebrow">Distribuição</p><h2>Por categoria</h2></div></header><div className="finance-list">{summary.categories.map((item) => <div key={item.id ?? "none"}><span><b>{item.name}</b></span><strong><Money value={item.amountCents / 100} /></strong></div>)}</div></section><section className="finance-panel"><header><div><p className="eyebrow">Evolução</p><h2>Por mês</h2></div></header><div className="finance-list">{summary.monthlyEvolution.map((item) => <div key={item.month}><span><b>{item.month}</b></span><strong><Money value={item.amountCents / 100} /></strong></div>)}</div></section></div></> : <section className="finance-panel finance-empty"><h3>Selecione uma pessoa</h3><p>O resumo mostrará os gastos, reembolsos, categorias e a evolução mensal.</p></section>}
  </main></ValueVisibility>;
}
