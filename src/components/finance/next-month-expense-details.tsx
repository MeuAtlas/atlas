"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AtlasModal,
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import { Money } from "./value-visibility";
import type {
  FinanceOverviewCommitment,
  FinanceOverviewInvoice,
  NextMonthExpenseGroup,
  NextMonthFinanceProjection,
} from "@/modules/finance/finance-overview-dashboard";

const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
}).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));

const dateLabel = (date: string | null, timeZone: string) => date
  ? new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
  : "Data não informada";

const paymentLabel = (channel: NextMonthExpenseGroup["paymentChannel"]) => ({
  bank: "Conta bancária",
  card: "Cartão de crédito",
  cash: "Dinheiro",
  payroll: "Desconto em folha",
  other: "Outra forma",
} as Partial<Record<NextMonthExpenseGroup["paymentChannel"], string>>)[channel] ?? "Outra forma";

function DetailRow({ title, detail, value, muted = false }: {
  title: string;
  detail: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className={`fov-expense-detail-row${muted ? " muted" : ""}`}>
      <span><b>{title}</b><small>{detail}</small></span>
      <strong><Money value={value} /></strong>
    </div>
  );
}

export function NextMonthExpenseDetails({
  month,
  projection,
  expenses,
  invoices,
  payrollDeductions,
  timeZone,
}: {
  month: string;
  projection: NextMonthFinanceProjection;
  expenses: NextMonthExpenseGroup[];
  invoices: FinanceOverviewInvoice[];
  payrollDeductions: FinanceOverviewCommitment[];
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const directCommitments = expenses.filter(item => item.paymentChannel !== "card");
  const cardCommitments = expenses.filter(item => item.paymentChannel === "card");
  const payrollTotal = payrollDeductions.reduce((sum, item) => sum + item.amount, 0);
  const hasInvoices = projection.expectedCardInvoices > 0;

  return (
    <>
      <button
        type="button"
        className="fov-projection-details-button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Detalhes
      </button>

      <AtlasModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Composição das despesas previstas de ${monthLabel(month)}`}
        description="Detalhamento dos compromissos, faturas e valores que não são somados novamente."
        size="medium"
      >
        <AtlasModalHeader>
          <div>
            <p className="eyebrow">COMPOSIÇÃO DA PREVISÃO</p>
            <h2>Despesas previstas de {monthLabel(month).split(" de ")[0]}</h2>
            <p className="atlas-modal-subtitle">
              Entenda exatamente de onde vem o total e como o Atlas evita duplicidades.
            </p>
          </div>
          <AtlasModalClose />
        </AtlasModalHeader>

        <AtlasModalBody className="fov-expense-details-body">
          <section className="fov-expense-equation" aria-label="Resumo do cálculo">
            <div><span>Compromissos</span><strong><Money value={projection.expectedCommitments} /></strong></div>
            <i aria-hidden="true">+</i>
            <div><span>Faturas</span><strong><Money value={projection.expectedCardInvoices} /></strong></div>
            <i aria-hidden="true">=</i>
            <div className="total"><span>Total previsto</span><strong><Money value={projection.expectedExpenses} /></strong></div>
          </section>

          <p className="fov-expense-explanation">
            Este valor representa o que deve sair da conta em {monthLabel(month)}. Compromissos pagos
            no cartão aparecem dentro da fatura e não são somados novamente. Compras de cartões atribuídos
            a outra pessoa são preservadas no total do banco, mas descontadas da sua parte prevista.
          </p>

          <section className="fov-expense-detail-section">
            <header>
              <div><span>SAÍDA DIRETA</span><h3>Compromissos fora do cartão</h3></div>
              <strong><Money value={projection.expectedCommitments} /></strong>
            </header>
            <div className="fov-expense-detail-list">
              {directCommitments.map(item => (
                <DetailRow
                  key={item.id}
                  title={item.title}
                  detail={`${item.context || "Sem contexto"} · ${paymentLabel(item.paymentChannel)} · ${dateLabel(item.expectedDate, timeZone)}`}
                  value={item.amount}
                />
              ))}
            </div>
            <Link href={`/financeiro/receitas-despesas?month=${month}`}>Ver receitas e despesas</Link>
          </section>

          <section className="fov-expense-detail-section">
            <header>
              <div><span>SAÍDA PELA FATURA</span><h3>Faturas com vencimento no mês</h3></div>
              <strong><Money value={projection.expectedCardInvoices} /></strong>
            </header>
            <div className="fov-expense-detail-list">
              {invoices.length ? invoices.map(invoice => (
                <div key={invoice.id}>
                  <DetailRow
                    title={`${invoice.name}${invoice.lastFour ? ` · final ${invoice.lastFour}` : ""}`}
                    detail={`${invoice.dueDate ? `Vence em ${dateLabel(invoice.dueDate, timeZone)}` : "Vencimento indisponível"}${invoice.partial ? " · Dados parciais" : ""} · Sua parte prevista`}
                    value={invoice.ownerPayableAmount??invoice.amount??0}
                  />
                  {(invoice.responsibleParties??[]).map(party=><DetailRow key={party.personId} title={`Parte de ${party.personName}`} detail={`Cartões finais ${party.cardFinals.join(" e ")} · abatida da sua previsão`} value={party.amount} muted />)}
                </div>
              )) : (
                <p className="fov-expense-detail-empty">
                  Nenhuma fatura disponível. {hasInvoices ? "O total informado foi preservado." : "Os compromissos de cartão são usados como estimativa."}
                </p>
              )}
            </div>
            <Link href="/financeiro/cartoes">Ver cartões</Link>
          </section>

          {cardCommitments.length ? (
            <section className="fov-expense-detail-section protected">
              <header>
                <div><span>SEM DUPLICIDADE</span><h3>Já incluídos nas faturas</h3></div>
              </header>
              <p>Estes compromissos ajudam a explicar a fatura, mas não são acrescentados novamente ao total.</p>
              <div className="fov-expense-detail-list">
                {cardCommitments.map(item => (
                  <DetailRow
                    key={item.id}
                    title={item.title}
                    detail={`${item.context || "Sem contexto"} · ${dateLabel(item.expectedDate, timeZone)} · Já considerado na fatura`}
                    value={item.amount}
                    muted
                  />
                ))}
              </div>
            </section>
          ) : null}

          {payrollDeductions.length ? (
            <section className="fov-expense-detail-section excluded">
              <header>
                <div><span>FORA DESTE CÁLCULO</span><h3>Descontos em folha</h3></div>
                <strong><Money value={payrollTotal} /></strong>
              </header>
              <p>Já foram retirados antes do salário líquido entrar na conta e, por isso, não reduzem o caixa novamente.</p>
              <div className="fov-expense-detail-list">
                {payrollDeductions.map(item => (
                  <DetailRow
                    key={item.id}
                    title={item.title}
                    detail={`${item.context || "Desconto em folha"} · Não somado às despesas previstas`}
                    value={item.amount}
                    muted
                  />
                ))}
              </div>
            </section>
          ) : null}
        </AtlasModalBody>
      </AtlasModal>
    </>
  );
}
