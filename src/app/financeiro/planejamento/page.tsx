import Link from "next/link";
import { EmptyState } from "@/components/finance/empty-state";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getMonthlyFinancialCommitments } from "@/modules/finance/commitments-query";
import { getSharedPlanningSummary } from "@/modules/finance/person-reimbursements-query";

const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const params = await searchParams;
  const { supabase } = await requireFinanceAccess();
  const workspaceResult = await supabase.from("workspaces")
    .select("id,name").order("type");
  const workspace = workspaceResult.data?.find(item =>
    item.id === params.workspace
  ) ?? workspaceResult.data?.[0];
  const currentMonth = `${new Date().toISOString().slice(0, 7)}-01`;
  const horizon = new Date(`${currentMonth}T12:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + 11);
  const [projections, sharedSummary] = workspace
    ? await Promise.all([
        getMonthlyFinancialCommitments(supabase, {
          workspaceId: workspace.id,
          from: currentMonth,
        }),
        getSharedPlanningSummary(
          supabase,
          workspace.id,
          currentMonth,
          `${horizon.toISOString().slice(0, 7)}-01`,
        ),
      ])
    : [[], {
        grossAmount: 0, userResponsibility: 0, reimbursementExpected: 0,
        reimbursementReceived: 0, reimbursementPending: 0,
        netProjectedCost: 0, sharedExpenseCount: 0,
      }];
  return (
    <ValueVisibility controls={false}>
      <section className="finance-panel planning-commitments">
        <header>
          <div>
            <p className="eyebrow">Planejamento consolidado</p>
            <h2>Receitas e despesas dos próximos meses</h2>
          </div>
          <Link href={`/financeiro/receitas-despesas${
            workspace ? `?workspace=${workspace.id}` : ""
          }`}>Gerenciar</Link>
        </header>
        {sharedSummary.sharedExpenseCount ? (
          <section
            className="planning-shared-summary"
            aria-label="Resumo de despesas compartilhadas"
          >
            <div><span>Despesa bruta</span><Money value={sharedSummary.grossAmount} /></div>
            <div><span>Minha parte</span><Money value={sharedSummary.userResponsibility} /></div>
            <div><span>Reembolso esperado</span><Money value={sharedSummary.reimbursementExpected} /></div>
            <div><span>Recebido</span><Money value={sharedSummary.reimbursementReceived} /></div>
            <div><span>Pendente</span><Money value={sharedSummary.reimbursementPending} /></div>
            <div><span>Custo líquido projetado</span><Money value={sharedSummary.netProjectedCost} /></div>
          </section>
        ) : null}
        {projections.length
          ? <div className="future-commitments">
              {projections.map(item => (
                <details key={item.competenceMonth}>
                  <summary>
                    <span>
                      <b>{monthLabel(item.competenceMonth)}</b>
                      <small>
                        {Object.values(item.sourceCounts).reduce((a, b) => a + b, 0)} itens ·{" "}
                        <Money value={item.confirmedTotalCents / 100} /> confirmados
                      </small>
                    </span>
                    <strong><Money value={item.totalCommittedCents / 100} /></strong>
                  </summary>
                  <dl className="planning-breakdown">
                    <div><dt>Receita esperada</dt><dd><Money value={item.expectedIncomeCents / 100} /></dd></div>
                    <div><dt>Recebido até agora</dt><dd><Money value={item.realizedIncomeCents / 100} /></dd></div>
                    <div><dt>Ainda esperado</dt><dd><Money value={item.remainingExpectedIncomeCents / 100} /></dd></div>
                    <div><dt>Saldo projetado</dt><dd><Money value={item.projectedBalanceCents / 100} /></dd></div>
                    <div><dt>Recorrentes</dt><dd><Money value={item.recurringTotalCents / 100} /></dd></div>
                    <div><dt>Parcelas</dt><dd><Money value={item.installmentTotalCents / 100} /></dd></div>
                    <div><dt>Empréstimos</dt><dd><Money value={item.loanTotalCents / 100} /></dd></div>
                    <div><dt>Folha — já considerado na renda líquida</dt>
                      <dd><Money value={item.payrollTotalCents / 100} /></dd></div>
                    <div><dt>Únicos</dt><dd><Money value={item.oneTimeTotalCents / 100} /></dd></div>
                    <div><dt>Projetado</dt><dd><Money value={item.projectedTotalCents / 100} /></dd></div>
                  </dl>
                  {item.payrollTotalCents > 0 ? (
                    <p className="planning-payroll-note">
                      Os descontos em folha são informativos e não foram
                      subtraídos novamente do saldo projetado.
                    </p>
                  ) : null}
                </details>
              ))}
            </div>
          : <EmptyState
              title="Nenhuma receita ou despesa futura"
              description="Cadastre valores recorrentes ou únicos para construir seu planejamento."
            />}
      </section>
    </ValueVisibility>
  );
}
