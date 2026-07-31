import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getPersonFinancialSummary } from "@/modules/finance/commitments-query";
import { getPersonPixSummary } from "@/modules/finance/person-reimbursements-query";
import { getIncomeExpenseOverview } from "@/modules/finance/income-expenses-query";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string;
    person?: string;
    category?: string;
    commitment?: string;
    kind?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireFinanceAccess();
  const workspaces = await supabase.from("workspaces").select("id,name").order("type");
  const workspace = workspaces.data?.find(item => item.id === params.workspace) ??
    workspaces.data?.[0];
  const today = new Date();
  const fromDefault = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1))
    .toISOString().slice(0, 10);
  const toDefault = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
  const [people, categories, commitments] = workspace
    ? await Promise.all([
        supabase.from("financial_people").select("id,name")
          .eq("workspace_id", workspace.id).neq("relation_type", "self")
          .is("archived_at", null).order("name"),
        supabase.from("financial_categories").select("id,name").order("name"),
        supabase.from("financial_commitments").select("id,title")
          .eq("workspace_id", workspace.id).is("archived_at", null).order("title"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const selectedPerson = people.data?.find(item => item.id === params.person);
  const [summary, pixSummary, flowSummary] = workspace
    ? await Promise.all([
        selectedPerson
          ? getPersonFinancialSummary(supabase, {
              workspaceId: workspace.id,
              personId: selectedPerson.id,
              from: params.from ?? fromDefault,
              to: params.to ?? toDefault,
            })
          : Promise.resolve(null),
        selectedPerson
          ? getPersonPixSummary(supabase, {
              workspaceId: workspace.id,
              personId: selectedPerson.id,
              from: params.from ?? fromDefault,
              to: params.to ?? toDefault,
            })
          : Promise.resolve(null),
        getIncomeExpenseOverview(supabase, {
          workspaceId: workspace.id,
          month: (params.to ?? toDefault).slice(0, 7),
        }),
      ])
    : [null, null, null];
  return (
    <ValueVisibility controls={false}>
      <div className="reports-page">
        <header>
          <div><p className="eyebrow">Análise financeira</p><h1>Relatórios</h1>
            <p>Compare receitas e despesas previstas com os valores realizados.</p></div>
        </header>
        <form className="finance-panel report-filters">
          <label>Espaço<select name="workspace" defaultValue={workspace?.id ?? ""}>
            {(workspaces.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Pessoa<select name="person" defaultValue={params.person ?? ""}>
            <option value="">Todas</option>
            {(people.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Categoria<select name="category" defaultValue={params.category ?? ""}>
            <option value="">Todas</option>
            {(categories.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Receita ou despesa<select name="commitment" defaultValue={params.commitment ?? ""}>
            <option value="">Todos</option>
            {(commitments.data ?? []).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select></label>
          <label>Natureza<select name="kind" defaultValue={params.kind ?? ""}>
            <option value="">Todas</option><option value="recurring">Recorrente</option>
            <option value="extraordinary">Extraordinário</option>
          </select></label>
          <label>De<input name="from" type="date" defaultValue={params.from ?? fromDefault} /></label>
          <label>Até<input name="to" type="date" defaultValue={params.to ?? toDefault} /></label>
          <button className="finance-button">Aplicar filtros</button>
        </form>
        {flowSummary ? (
          <section className="commitment-summary-grid report-summary">
            <article><span>Receitas esperadas</span><strong className="positive"><Money value={flowSummary.overview.expectedIncomeCents / 100} /></strong></article>
            <article><span>Receitas realizadas</span><strong className="positive"><Money value={flowSummary.overview.receivedIncomeCents / 100} /></strong></article>
            <article><span>Despesas previstas</span><strong><Money value={flowSummary.overview.expectedExpenseCents / 100} /></strong></article>
            <article><span>Despesas realizadas</span><strong><Money value={flowSummary.overview.paidExpenseCents / 100} /></strong></article>
            <article><span>Resultado realizado</span><strong><Money value={flowSummary.overview.realizedBalanceCents / 100} /></strong></article>
            <article><span>Planejamento</span><strong><Money value={flowSummary.overview.projectedBalanceCents / 100} /></strong></article>
          </section>
        ) : null}
        {flowSummary?.payrollDeductions.length ? (
          <section className="finance-panel report-payroll-summary">
            <header><div><p className="eyebrow">Composição da folha</p>
              <h2>Descontos em folha</h2>
              <p>
                Gastos analíticos já retirados antes do crédito da renda
                líquida. Não representam uma nova redução do saldo.
              </p></div>
              <strong><Money value={
                flowSummary.payrollDeductions.reduce(
                  (sum, item) => sum +
                    (item.realizedAmountCents || item.expectedAmountCents),
                  0,
                ) / 100
              } /></strong>
            </header>
            <div className="finance-list">
              {flowSummary.payrollDeductions.map(item => (
                <div key={item.id}>
                  <span><b>{item.title}</b>
                    <small>{item.personNames.join(", ") || "Sem pessoa vinculada"}</small>
                  </span>
                  <strong><Money value={
                    (item.realizedAmountCents || item.expectedAmountCents) / 100
                  } /></strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {summary ? <>
          <section className="commitment-summary-grid report-summary">
            <article><span>Total atribuído</span><strong><Money value={summary.totalSpentCents / 100} /></strong></article>
            <article><span>Realizado</span><strong className="positive"><Money value={summary.actualSpentCents / 100} /></strong></article>
            <article><span>Projetado</span><strong><Money value={summary.projectedCommitmentsCents / 100} /></strong></article>
            <article><span>Recorrente</span><strong><Money value={summary.recurringMonthlyCents / 100} /></strong></article>
            <article><span>Média mensal</span><strong><Money value={summary.averageMonthlyCents / 100} /></strong></article>
            <article><span>Despesa bruta</span><strong><Money value={pixSummary?.grossExpenseAmount ?? 0} /></strong></article>
            <article><span>Custo líquido</span><strong><Money value={pixSummary?.netUserCost ?? 0} /></strong></article>
            <article><span>Reembolsado</span><strong className="positive"><Money value={pixSummary?.reimbursedAmount ?? 0} /></strong></article>
            <article><span>Reembolso pendente</span><strong><Money value={pixSummary?.pendingReimbursementAmount ?? 0} /></strong></article>
            <article><span>Pix enviados</span><strong><Money value={pixSummary?.pixSentAmount ?? 0} /></strong></article>
            <article><span>Pix recebidos</span><strong><Money value={pixSummary?.pixReceivedAmount ?? 0} /></strong></article>
          </section>
          <div className="report-grid">
            <section className="finance-panel"><header><div><p className="eyebrow">Distribuição</p><h2>Por categoria</h2></div></header>
              <div className="finance-list">{summary.categories.map(item => <div key={item.id ?? "none"}><span><b>{item.name}</b></span><strong><Money value={item.amountCents / 100} /></strong></div>)}</div>
            </section>
            <section className="finance-panel"><header><div><p className="eyebrow">Evolução</p><h2>Por mês</h2></div></header>
              <div className="finance-list">{summary.monthlyEvolution.map(item => <div key={item.month}><span><b>{item.month}</b></span><strong><Money value={item.amountCents / 100} /></strong></div>)}</div>
            </section>
          </div>
        </> : <section className="finance-panel commitment-empty"><h3>Selecione uma pessoa</h3><p>O resumo mostrará realizado, projetado, recorrente, extraordinário, categorias e evolução mensal.</p></section>}
      </div>
    </ValueVisibility>
  );
}
