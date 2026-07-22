import Link from "next/link";
import { EmptyState } from "@/components/finance/empty-state";
import { FinanceChart } from "@/components/finance/finance-chart";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { requireFinanceAccess } from "@/modules/finance/access";
import { summarizeFinance } from "@/modules/finance/calculations";
import { formatDate } from "@/modules/finance/format";
import { getFinanceData } from "@/modules/finance/queries";

export default async function FinancePage() {
  const { supabase, user } = await requireFinanceAccess();
  const data = await getFinanceData(supabase, user.id);
  const summary = summarizeFinance(data.accounts, data.transactions);
  const invested = data.investments.reduce((total,item)=>total+Number(item.balance),0);
  const debt = data.loans.reduce((total,item)=>total+Number(item.balance_due),0);
  const nextDue = data.transactions
    .filter((transaction) => transaction.due_date && !["realized", "cancelled"].includes(transaction.status))
    .slice(0, 5);

  return (
    <ValueVisibility>
      <section className="finance-hero">
        <div>
          <p>Saldo disponível</p>
          <strong><Money value={summary.available} /></strong>
          <span>Resultado do mês: <Money value={summary.monthlyResult} /></span>
        </div>
        <div className="finance-projection">
          <small>Projeção do mês</small>
          <b><Money value={summary.projected} /></b>
        </div>
      </section>

      <section className="finance-summary">
        {[
          ["Receitas", summary.income, "positive"],
          ["Despesas", summary.expenses, "negative"],
          ["A receber", summary.receivable, ""],
          ["A pagar", summary.payable, ""],
          ["Vencido", summary.overdue, "negative"],
        ].map(([label, value, className]) => (
          <Link href="/financeiro/movimentacoes" key={String(label)} className={`finance-stat ${className}`}>
            <span>{label}</span>
            <b><Money value={Number(value)} /></b>
          </Link>
        ))}
      </section>

      <div className="finance-dashboard-grid">
        <section className="finance-panel"><header><h2>Patrimônio conectado</h2><Link href="/financeiro/integracoes">Integrações</Link></header><div className="finance-list"><div><span><b>Investimentos</b><small>{data.investments.length} posições importadas</small></span><strong className="positive"><Money value={invested}/></strong></div><div><span><b>Empréstimos</b><small>{data.loans.length} contratos importados</small></span><strong className="negative"><Money value={debt}/></strong></div>{data.connections[0]?<div><span><b>Última sincronização</b><small>{data.connections[0].connector_name||"Pluggy"}</small></span><strong>{data.connections[0].last_successful_sync_at?formatDate(data.connections[0].last_successful_sync_at):"Pendente"}</strong></div>:null}</div></section>
        <section className="finance-panel finance-chart-panel">
          <header><div><p className="eyebrow">Fluxo financeiro</p><h2>Receitas e despesas</h2></div><span>12 meses</span></header>
          <FinanceChart transactions={data.transactions} />
        </section>
        <section className="finance-panel">
          <header><h2>Próximos vencimentos</h2><Link href="/financeiro/movimentacoes">Ver todos</Link></header>
          {nextDue.length ? <div className="finance-list">{nextDue.map((transaction) => <div key={transaction.id}><span><b>{transaction.description}</b><small>{formatDate(transaction.due_date)}</small></span><strong className="negative"><Money value={Number(transaction.amount)} /></strong></div>)}</div> : <EmptyState title="Tudo em dia" description="Cadastre contas futuras para acompanhar vencimentos." href="/financeiro/movimentacoes#nova" label="Adicionar movimentação" />}
        </section>
        <section className="finance-panel">
          <header><h2>Contas e saldos</h2><Link href="/financeiro/contas">Gerenciar</Link></header>
          {data.accounts.length ? <div className="finance-list">{data.accounts.filter((account) => account.status === "active").slice(0, 5).map((account) => <div key={account.id}><span><b>{account.name}</b><small>{account.institution_name || "Conta manual"}</small></span><strong><Money value={Number(account.current_balance)} /></strong></div>)}</div> : <EmptyState title="Nenhuma conta" description="Crie sua primeira conta para consolidar os saldos." href="/financeiro/contas#nova" label="Criar conta" />}
        </section>
        <section className="finance-panel">
          <header><h2>Atenção necessária</h2></header>
          <div className="finance-list"><div><span><b>{summary.overdue ? "Existem valores vencidos" : "Nenhuma pendência crítica"}</b><small>{summary.overdue ? "Revise as movimentações em atraso." : "Seu financeiro está organizado."}</small></span><i className={summary.overdue ? "status danger" : "status success"}>{summary.overdue ? "Revisar" : "Em dia"}</i></div></div>
        </section>
      </div>
    </ValueVisibility>
  );
}
