import { EmptyState } from "@/components/finance/empty-state";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { requireFinanceAccess } from "@/modules/finance/access";
import { calculateFutureCardCommitments } from "@/modules/finance/invoice-import/projections";

const monthLabel = (date: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(`${date}T12:00:00Z`));

export default async function Page() {
  const { supabase, user } = await requireFinanceAccess();
  const start = new Date().toISOString().slice(0, 7) + "-01";
  const result = await supabase.from("card_installment_occurrences")
    .select("competence_month,amount,status,confidence,installment_plan_id,card_installment_plans(status)")
    .eq("owner_id", user.id).gte("competence_month", start)
    .in("status", ["projected", "confirmed"]).order("competence_month");
  const commitments = calculateFutureCardCommitments((result.data ?? []).map(row => ({
    competenceMonth: String(row.competence_month),
    amountCents: Math.round(Number(row.amount) * 100),
    status: String(row.status),
    confidence: Number(row.confidence),
  })));
  return (
    <ValueVisibility controls={false}>
      <section className="finance-panel">
        <header><div><p className="eyebrow">Compromissos contratados</p><h2>Próximos meses</h2></div>
          <span>{commitments.length} competências</span></header>
        {commitments.length ? <div className="future-commitments">
          {commitments.map(item => <article key={item.competenceMonth}>
            <span><b>{monthLabel(item.competenceMonth)}</b>
              <small>{item.sourceCount} parcelas já contratadas · confiança {Math.round(item.confidence * 100)}%</small></span>
            <strong><Money value={item.totalCommittedCents / 100} /></strong>
          </article>)}
        </div> : <EmptyState title="Nenhuma parcela futura confirmada"
          description="Ao importar uma fatura PDF, os parcelamentos revisados aparecerão aqui." />}
      </section>
    </ValueVisibility>
  );
}
