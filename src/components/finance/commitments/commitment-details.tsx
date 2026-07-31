"use client";

import Link from "next/link";
import {
  archiveFinancialCommitment,
  completeFinancialCommitment,
  linkCommitmentToPerson,
  markCommitmentOccurrencePaid,
  pauseFinancialCommitment,
  resumeFinancialCommitment,
  skipCommitmentOccurrence,
  unlinkCommitmentFromPerson,
} from "@/modules/finance/commitments-actions";
import {
  commitmentOccurrenceStatusLabel,
  type CommitmentOccurrence,
} from "@/modules/finance/commitments";
import type {
  CommitmentListItem,
  CommitmentsOverview,
} from "@/modules/finance/commitments-query";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import type { ConfirmActionConfig } from "./confirm-action";

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(`${value}T12:00:00Z`),
      )
    : "Sem data";

const tagLabels: Record<string, string> = {
  required: "Obrigatório",
  essential: "Essencial",
  health: "Saúde",
  education: "Educação",
  dependent: "Dependente",
  subscription: "Assinatura",
};

const paymentMethodLabels: Record<string, string> = {
  transfer: "Conta corrente",
  credit_card: "Cartão",
  bank_debit: "Débito automático",
  payroll: "Desconto em folha",
  boleto: "Boleto",
  other: "Manual",
};

export function CommitmentDetails({
  item,
  workspaceId,
  availablePeople,
  onEdit,
  onEditAmount,
  onConfirm,
}: {
  item: CommitmentListItem;
  workspaceId: string;
  availablePeople: CommitmentsOverview["people"];
  onEdit: () => void;
  onEditAmount: (occurrence: CommitmentOccurrence) => void;
  onConfirm: (
    config: Omit<ConfirmActionConfig, "fields"> & {
      fields?: Record<string, string>;
    },
  ) => void;
}) {
  const editableOccurrence =
    item.currentOccurrence &&
      !["paid", "partially_paid", "cancelled", "skipped"].includes(
        item.currentOccurrence.status,
      )
      ? item.currentOccurrence
      : item.futureOccurrence;
  const skippableOccurrence =
    item.currentOccurrence &&
      !["paid", "partially_paid", "cancelled", "skipped"].includes(
        item.currentOccurrence.status,
      )
      ? item.currentOccurrence
      : item.futureOccurrence;
  const hidden = <>
    <input type="hidden" name="workspace_id" value={workspaceId} />
    <input type="hidden" name="commitment_id" value={item.commitment.id} />
  </>;
  return (
    <div className="commitment-detail">
      <AtlasModalHeader>
        <div>
          <p className="eyebrow">{item.categoryName ?? "Sem categoria"}</p>
          <h2>{item.commitment.title}</h2>
          <p className="atlas-modal-subtitle">
            {item.commitment.cashFlowDirection === "income"
              ? "Receita recorrente"
              : "Despesa recorrente"}
          </p>
        </div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody className="commitment-detail-body">
        <strong>{money(item.commitment.expectedAmountCents ?? 0)}</strong>
        <dl>
          <div><dt>Status</dt><dd>{commitmentOccurrenceStatusLabel(item.commitment.status)}</dd></div>
          <div><dt>Frequência</dt><dd>{item.commitment.recurrenceFrequency ?? "Única"}</dd></div>
          <div><dt>Próximo vencimento</dt><dd>{date(item.nextOccurrence?.expectedDueDate ?? null)}</dd></div>
          <div>
            <dt>Pagamento</dt>
            <dd>
              {item.commitment.paymentMethod === "payroll"
                ? paymentMethodLabels.payroll
                : item.accountName ??
                  item.cardName ??
                  paymentMethodLabels[item.commitment.paymentMethod ?? ""] ??
                  "Não definido"}
            </dd>
          </div>
          <div><dt>Pessoa vinculada</dt><dd>{item.people.map(person => person.name).join(", ") || "Sem vínculo"}</dd></div>
          {item.commitment.isPayrollDeduction ? (
            <div><dt>Efeito no saldo disponível</dt>
              <dd>Já considerado na renda líquida</dd></div>
          ) : null}
          <div>
            <dt>Contexto</dt>
            <dd>{item.commitment.analysisGroupName ?? "Conta própria"}</dd>
          </div>
          <div>
            <dt>Ocorrência do mês</dt>
            <dd>
              {item.currentOccurrence
                ? commitmentOccurrenceStatusLabel(
                  item.currentOccurrence.status,
                  item.commitment.isPayrollDeduction,
                )
                : "Ainda não gerada"}
            </dd>
          </div>
          <div><dt>Orçamento mensal</dt><dd>{item.commitment.includeInMonthlyBudget === false ? "Não participa" : "Participa"}</dd></div>
          <div>
            <dt>Projeções futuras</dt>
            <dd>
              {item.commitment.generatesFutureProjections
                ? "Móvel: somente o próximo mês"
                : "Desativadas"}
            </dd>
          </div>
        </dl>
        <section className="commitment-occurrence-window">
          <header>
            <div>
              <p className="eyebrow">Horizonte móvel</p>
              <h3>Mês vigente e próximo mês</h3>
            </div>
            <span>Geração automática</span>
          </header>
          <div>
            <article>
              <span>Mês vigente</span>
              <strong>
                {item.currentOccurrence
                  ? money(item.currentOccurrence.expectedAmountCents ?? 0)
                  : "Sem ocorrência"}
              </strong>
              <small>
                {item.currentOccurrence
                  ? `${date(item.currentOccurrence.expectedDueDate)} · ${
                    commitmentOccurrenceStatusLabel(
                      item.currentOccurrence.status,
                      item.commitment.isPayrollDeduction,
                    )
                  }`
                  : "Ainda não gerada"}
              </small>
            </article>
            <article>
              <span>Próximo mês</span>
              <strong>
                {item.futureOccurrence
                  ? money(item.futureOccurrence.expectedAmountCents ?? 0)
                  : "Sem previsão"}
              </strong>
              <small>
                {item.futureOccurrence
                  ? `${date(item.futureOccurrence.expectedDueDate)} · ${
                    commitmentOccurrenceStatusLabel(
                      item.futureOccurrence.status,
                      item.commitment.isPayrollDeduction,
                    )
                  }`
                  : item.commitment.status === "active"
                    ? "Será criada automaticamente"
                    : "Recorrência inativa"}
              </small>
            </article>
          </div>
        </section>
        {item.commitment.tags?.length ? (
          <div className="commitment-detail-tags">
            {item.commitment.tags.map(tag => <span key={tag}>{tagLabels[tag] ?? tag}</span>)}
          </div>
        ) : null}
        {item.commitment.description ? <p>{item.commitment.description}</p> : null}
        <details className="commitment-people-editor">
          <summary>Dividir entre pessoas</summary>
          <form action={linkCommitmentToPerson}>
            <input type="hidden" name="workspace_id" value={workspaceId} />
            <input type="hidden" name="commitment_id" value={item.commitment.id} />
            <select name="person_id" required defaultValue="">
              <option value="" disabled>Selecione uma pessoa</option>
              {availablePeople.map(row =>
                <option key={row.person.id} value={row.person.id}>{row.person.name}</option>)}
            </select>
            <select name="allocation_type" defaultValue="percentage">
              <option value="full">Integral</option>
              <option value="percentage">Percentual</option>
              <option value="fixed_amount">Valor fixo</option>
            </select>
            <input name="allocation_value" inputMode="decimal" placeholder="Percentual ou valor" required />
            <button>Salvar divisão</button>
          </form>
          {item.people.map(person => <form action={unlinkCommitmentFromPerson} key={person.id}>
            <input type="hidden" name="workspace_id" value={workspaceId} />
            <input type="hidden" name="commitment_id" value={item.commitment.id} />
            <input type="hidden" name="person_id" value={person.id} />
            <span>{person.name}</span><button>Remover</button>
          </form>)}
        </details>
        {item.history.length ? (
          <section className="commitment-history">
            <h3>HistÃ³rico do compromisso</h3>
            <ol>
              {item.history.map(event => (
                <li key={event.id}>
                  <i aria-hidden="true" />
                  <span>
                    <b>{event.summary}</b>
                    <small>{new Intl.DateTimeFormat("pt-BR", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(event.createdAt))}</small>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        <div className="commitment-action-grid">
          {!item.commitment.isPayrollDeduction ? (
            <Link
              className="commitment-action-link"
              href={`/financeiro/movimentacoes?workspace=${workspaceId}&search=${
                encodeURIComponent(item.commitment.title)
              }`}
            >
              Vincular movimentação
            </Link>
          ) : null}
          {item.currentOccurrence &&
              !["paid", "cancelled", "skipped"].includes(
                item.currentOccurrence.status,
              ) ? (
            <button type="button" onClick={() => onConfirm({
              title: "Confirmar pagamento deste mês?",
              description: item.commitment.isPayrollDeduction
                ? "O valor será confirmado na competência, sem criar saída bancária."
                : "A ocorrência será marcada como paga manualmente. Nenhuma movimentação bancária será criada.",
              confirmLabel: item.commitment.isPayrollDeduction
                ? "Confirmar valor do mês"
                : "Marcar como pago",
              action: markCommitmentOccurrencePaid,
              fields: { occurrence_id: item.currentOccurrence!.id },
            })}>
              {item.commitment.isPayrollDeduction
                ? "Confirmar valor do mês"
                : "Marcar como pago"}
            </button>
          ) : null}
          <button type="button" onClick={onEdit}>Editar</button>
          {editableOccurrence ? (
            <button
              type="button"
              onClick={() => onEditAmount(editableOccurrence)}
            >
              Alterar valor
            </button>
          ) : null}
          {item.commitment.status === "active"
            ? <form action={pauseFinancialCommitment}>{hidden}<button>Pausar</button></form>
            : item.commitment.status === "paused"
              ? <form action={resumeFinancialCommitment}>{hidden}<button>Retomar</button></form>
              : null}
          {skippableOccurrence ? (
            <button type="button" onClick={() => onConfirm({
              title: skippableOccurrence === item.currentOccurrence
                ? "Pular somente este mês?"
                : "Pular a próxima ocorrência?",
              description:
                "Esta previsão será ignorada, mas a recorrência continuará ativa e voltará a gerar o mês seguinte.",
              confirmLabel: "Pular ocorrência",
              action: skipCommitmentOccurrence,
              fields: { occurrence_id: skippableOccurrence.id },
            })}>
              {skippableOccurrence === item.currentOccurrence
                ? "Pular este mês"
                : "Pular próximo mês"}
            </button>
          ) : null}
          <button type="button" onClick={() => onConfirm({
            title: "Encerrar recorrência definitivamente?",
            description:
              "Pagamentos e histórico serão preservados. Previsões futuras ainda não pagas serão canceladas e nenhum novo mês será gerado.",
            confirmLabel: "Encerrar recorrência",
            action: completeFinancialCommitment,
          })}>Encerrar</button>
          <button type="button" className="danger" onClick={() => onConfirm({
            title: "Arquivar compromisso?",
            description: "O compromisso sairá das listas ativas. O histórico financeiro será preservado.",
            confirmLabel: "Arquivar",
            action: archiveFinancialCommitment,
          })}>Arquivar</button>
        </div>
      </AtlasModalBody>
    </div>
  );
}
