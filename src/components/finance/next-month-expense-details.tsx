"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AtlasModal,
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import { AtlasText } from "@/components/ui/atlas-text";
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
      <span>
        <AtlasText as="b" variant="itemTitle">{title}</AtlasText>
        <AtlasText as="small" variant="secondary">{detail}</AtlasText>
      </span>
      <AtlasText as="strong" variant="financialValueSmall"><Money value={value} /></AtlasText>
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
            <AtlasText as="p" variant="label">COMPOSIÇÃO DA PREVISÃO</AtlasText>
            <AtlasText as="h2" variant="modalTitle">
              Despesas previstas de {monthLabel(month).split(" de ")[0]}
            </AtlasText>
            <AtlasText as="p" variant="body" className="atlas-modal-subtitle">
              Veja os valores considerados na previsão e os itens apenas informativos.
            </AtlasText>
          </div>
          <AtlasModalClose />
        </AtlasModalHeader>

        <AtlasModalBody className="fov-expense-details-body">
          <section className="fov-expense-equation" aria-label="Resumo do cálculo">
            <div><AtlasText as="span" variant="secondary">Compromissos</AtlasText><AtlasText as="strong" variant="financialValueSmall"><Money value={projection.expectedCommitments} /></AtlasText></div>
            <i aria-hidden="true">+</i>
            <div><AtlasText as="span" variant="secondary">Faturas</AtlasText><AtlasText as="strong" variant="financialValueSmall"><Money value={projection.expectedCardInvoices} /></AtlasText></div>
            <i aria-hidden="true">=</i>
            <div className="total"><AtlasText as="span" variant="secondary">Total previsto</AtlasText><AtlasText as="strong" variant="financialValueSmall"><Money value={projection.expectedExpenses} /></AtlasText></div>
          </section>

          <AtlasText as="p" variant="body" className="fov-expense-explanation">
            Este valor representa o que deve sair da conta em {monthLabel(month)}. Compromissos pagos
            no cartão aparecem dentro da fatura e não são somados novamente. Compras de cartões atribuídos
            a outra pessoa são preservadas no total do banco, mas descontadas da sua parte prevista.
          </AtlasText>

          <section className="fov-expense-detail-section">
            <header>
              <div><AtlasText variant="label">SAÍDA DIRETA</AtlasText><AtlasText as="h3" variant="sectionTitle">Compromissos fora do cartão</AtlasText></div>
              <AtlasText as="strong" variant="financialValueSmall"><Money value={projection.expectedCommitments} /></AtlasText>
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
              <div><AtlasText variant="label">SAÍDA PELA FATURA</AtlasText><AtlasText as="h3" variant="sectionTitle">Faturas com vencimento no mês</AtlasText></div>
              <AtlasText as="strong" variant="financialValueSmall"><Money value={projection.expectedCardInvoices} /></AtlasText>
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
                <div><AtlasText variant="label">SEM DUPLICIDADE</AtlasText><AtlasText as="h3" variant="sectionTitle">Já incluídos nas faturas</AtlasText></div>
              </header>
              <AtlasText as="p" variant="body">Estes compromissos ajudam a explicar a fatura, mas não são acrescentados novamente ao total.</AtlasText>
              <div className="fov-expense-detail-list">
                {cardCommitments.map(item => (
                  <DetailRow
                    key={item.id}
                    title={item.title}
                    detail={`${item.context || "Sem contexto"} · ${dateLabel(item.expectedDate, timeZone)}`}
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
                <div><AtlasText variant="label">FORA DESTE CÁLCULO</AtlasText><AtlasText as="h3" variant="sectionTitle">Descontos em folha</AtlasText></div>
                <AtlasText as="strong" variant="financialValueSmall"><Money value={payrollTotal} /></AtlasText>
              </header>
              <AtlasText as="p" variant="body">Já descontados antes do salário líquido entrar na conta.</AtlasText>
              <div className="fov-expense-detail-list">
                {payrollDeductions.map(item => (
                  <DetailRow
                    key={item.id}
                    title={item.title}
                    detail={item.context || "Desconto em folha"}
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
