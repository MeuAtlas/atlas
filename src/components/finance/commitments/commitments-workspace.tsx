"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  archiveFinancialPerson,
  rejectRecurringSuggestion,
} from "@/modules/finance/commitments-actions";
import type {
  CommitmentListItem,
  CommitmentsOverview,
} from "@/modules/finance/commitments-query";
import {
  commitmentOccurrenceStatusLabel,
  type CommitmentOccurrence,
} from "@/modules/finance/commitments";
import type { RecurringCommitmentSuggestion } from "@/modules/finance/commitment-suggestions";
import type {
  PersonFinancialDashboardData,
  PersonSpendForPeriod,
} from "@/modules/finance/person-financial-dashboard";
import {
  filterRecurringCommitmentGroups,
  type RecurringCommitmentFilter,
  type RecurringCommitmentItem,
} from "@/modules/finance/recurring-commitments-overview";
import { AtlasModal } from "@/components/ui/atlas-modal";
import { CommitmentForm } from "./commitment-form";
import { SimpleCommitmentModal } from "./simple-commitment-modal";
import { CommitmentDetails } from "./commitment-details";
import { CommitmentAmountForm } from "./commitment-amount-form";
import {
  ConfirmAction,
  type ConfirmActionConfig,
} from "./confirm-action";
import { PersonDetails } from "./person-details";
import { PersonForm, personRelationOptions } from "./person-form";

type Option = { id: string; name: string };
type PersonRow = CommitmentsOverview["people"][number];
type DetailModalState =
  | { kind: "commitment-details"; item: CommitmentListItem }
  | { kind: "person-details"; item: PersonRow };
type ModalState =
  | { kind: "commitment-create"; personId?: string }
  | { kind: "commitment-edit"; item: CommitmentListItem }
  | {
      kind: "commitment-amount";
      item: CommitmentListItem;
      occurrence: CommitmentOccurrence;
    }
  | DetailModalState
  | { kind: "person-create" }
  | { kind: "person-edit"; item: PersonRow }
  | { kind: "recurring-filters" }
  | ({
      kind: "confirm";
      fields: Record<string, string>;
      returnTo: DetailModalState;
    } & ConfirmActionConfig)
  | null;

const legacyRelationLabels: Record<string, string> = {
  child: "Filha(o)",
  spouse: "Cônjuge",
  wife: "Esposa",
  husband: "Esposo",
  parent: "Pai ou mãe",
  dependent: "Dependente",
  family: "Outro familiar",
};
const relationLabel = (value: string) =>
  personRelationOptions.find(([key]) => key === value)?.[1] ??
  legacyRelationLabels[value] ??
  value;

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

function SummaryCards({
  overview,
}: {
  overview: CommitmentsOverview;
}) {
  const recurring = overview.recurring;
  const cards = [
    ["Recorrente mensal total", money(recurring.totalRecurring)],
    ["Minhas contas", money(recurring.ownRecurring)],
    ["Dependentes", money(recurring.dependentsRecurring)],
    ["Casa", money(recurring.householdRecurring)],
    ["Pendente neste mês", money(recurring.pendingAmount)],
    [
      "Próximo vencimento",
      recurring.nextDue
        ? `${date(recurring.nextDue.date)} · ${money(recurring.nextDue.amountCents)}`
        : "Nenhum",
    ],
  ] as const;
  return (
    <section className="commitment-summary-grid compact recurring-summary" aria-label="Resumo mensal">
      {cards.map(([label, value]) => (
        <article key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

const recurringFilterLabels: Record<RecurringCommitmentFilter, string> = {
  all: "Todas",
  own: "Minhas",
  dependents: "Dependentes",
  household: "Casa",
  work: "Trabalho",
  travel: "Viagem",
  paid: "Pagas",
  pending: "Pendentes",
  overdue: "Atrasadas",
};

const recurringStatusLabels: Record<RecurringCommitmentItem["status"], string> = {
  paid: "Pago",
  pending: "A pagar",
  overdue: "Atrasado",
  projected: "A pagar",
  paused: "Pausado",
};

const paymentMethodLabels: Record<string, string> = {
  transfer: "Conta corrente",
  credit_card: "Cartão",
  bank_debit: "Débito automático",
  payroll: "Desconto em folha",
  pix: "Pix",
  boleto: "Boleto",
  cash: "Dinheiro",
  other: "Manual",
};

const frequencyLabels: Record<string, string> = {
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  bimonthly: "Bimestral",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual",
  custom: "Personalizada",
};

export function CommitmentsWorkspace({
  overview,
  activeTab,
  month,
  workspaces,
  categories,
  accounts,
  cards,
  householdGroups,
  suggestions,
  personDashboards,
  personSpends,
}: {
  overview: CommitmentsOverview;
  activeTab: "overview" | "recurring" | "people";
  month: string;
  workspaces: Option[];
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  householdGroups: Option[];
  suggestions: RecurringCommitmentSuggestion[];
  personDashboards: Record<string, PersonFinancialDashboardData>;
  personSpends: Record<string, PersonSpendForPeriod>;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [personFilter, setPersonFilter] = useState("");
  const [recurringFilter, setRecurringFilter] =
    useState<RecurringCommitmentFilter>("all");
  const [showAllDue, setShowAllDue] = useState(false);
  const [toast, setToast] = useState("");
  const closeModal = useCallback(() => setModal(null), []);
  const dismissModal = useCallback(() => {
    setModal(current => current?.kind === "confirm" ? current.returnTo : null);
  }, []);
  const filteredCommitments = useMemo(
    () => personFilter
      ? overview.commitments.filter(item =>
          item.people.some(person => person.id === personFilter)
        )
      : overview.commitments,
    [overview.commitments, personFilter],
  );
  const recurring = useMemo(
    () => filteredCommitments.filter(item =>
      item.commitment.commitmentType !== "one_time"
    ),
    [filteredCommitments],
  );
  const query = `workspace=${overview.workspaceId}&month=${month}`;
  const peopleWithSpend = useMemo(() => overview.people
    .filter(item => item.person.relationType !== "self")
    .filter(item => {
      const spend = personSpends[item.person.id];
      return Boolean(spend?.netSpent || spend?.futureCommitments);
    })
    .sort((left, right) =>
      (personSpends[right.person.id]?.netSpent ?? 0) -
      (personSpends[left.person.id]?.netSpent ?? 0)
    ), [overview.people, personSpends]);
  const recurringGroups = useMemo(
    () => filterRecurringCommitmentGroups(
      overview.recurring.groups,
      recurringFilter,
    ),
    [overview.recurring.groups, recurringFilter],
  );
  const upcomingRecurring = useMemo(() =>
    overview.commitments.filter(item =>
      item.commitment.commitmentType !== "one_time" &&
      item.commitment.cashFlowDirection !== "income" &&
      item.commitment.status === "active" &&
      item.nextOccurrence &&
      !["paid", "cancelled", "skipped"].includes(item.nextOccurrence.status)
    ).sort((left, right) =>
      (left.nextOccurrence?.expectedDueDate ?? "").localeCompare(
        right.nextOccurrence?.expectedDueDate ?? "",
      )
    ), [overview.commitments]);
  const upcomingOneTime = useMemo(() =>
    overview.commitments.filter(item =>
      item.commitment.commitmentType === "one_time" &&
      item.commitment.status === "active" &&
      item.currentOccurrence &&
      !["paid", "cancelled", "skipped"].includes(
        item.currentOccurrence.status,
      )
    ).sort((left, right) =>
      (left.currentOccurrence?.expectedDueDate ?? "").localeCompare(
        right.currentOccurrence?.expectedDueDate ?? "",
      )
    ), [overview.commitments]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onSaved = (message: string) => {
    closeModal();
    setToast(message);
    router.refresh();
  };
  const openDetails = (item: CommitmentListItem) => {
    setModal({ kind: "commitment-details", item });
  };
  const openRecurringDetails = (item: RecurringCommitmentItem) => {
    const source = overview.commitments.find(candidate =>
      candidate.commitment.id === item.commitmentId
    );
    if (source) openDetails(source);
  };
  const openConfirmation = (
    input: Omit<ConfirmActionConfig, "fields"> & {
      fields?: Record<string, string>;
    },
    item: CommitmentListItem,
  ) => setModal({
    kind: "confirm",
    ...input,
    fields: {
      workspace_id: overview.workspaceId,
      commitment_id: item.commitment.id,
      ...input.fields,
    },
    returnTo: { kind: "commitment-details", item },
  });

  return (
    <div className="commitments-page">
      <header className="commitments-header">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1>Compromissos</h1>
          <p>Acompanhe recorrências, vencimentos e responsabilidades por pessoa.</p>
        </div>
        <div className="commitments-header-actions">
          <button
            className="finance-button"
            onClick={() => setModal({ kind: "commitment-create" })}
          >
            Adicionar compromisso
          </button>
        </div>
      </header>

      <div className="commitment-context">
        <label>
          Espaço
          <select
            value={overview.workspaceId}
            onChange={event => {
              window.location.assign(
                `/financeiro/compromissos?workspace=${event.target.value}&month=${month}&tab=${activeTab}`,
              );
            }}
          >
            {workspaces.map(item =>
              <option key={item.id} value={item.id}>{item.name}</option>
            )}
          </select>
        </label>
        <label>
          Mês
          <input
            type="month"
            value={month}
            onChange={event => {
              window.location.assign(
                `/financeiro/compromissos?workspace=${overview.workspaceId}&month=${event.target.value}&tab=${activeTab}`,
              );
            }}
          />
        </label>
        <label>
          Pessoa
          <select
            aria-label="Filtrar por pessoa"
            value={personFilter}
            onChange={event => setPersonFilter(event.target.value)}
          >
            <option value="">Todas as pessoas</option>
            {overview.people.map(row =>
              <option key={row.person.id} value={row.person.id}>
                {row.person.name}
              </option>
            )}
          </select>
        </label>
      </div>

      <nav className="commitment-tabs" aria-label="Compromissos">
        <Link className={activeTab === "overview" ? "active" : ""} href={`/financeiro/compromissos?${query}&tab=overview`}>
          Visão geral
        </Link>
        <Link className={activeTab === "recurring" ? "active" : ""} href={`/financeiro/compromissos?${query}&tab=recurring`}>
          Recorrentes
        </Link>
        <Link className={activeTab === "people" ? "active" : ""} href={`/financeiro/compromissos?${query}&tab=people`}>
          Pessoas e dependentes
        </Link>
      </nav>

      {activeTab === "overview" ? (
        <>
          <SummaryCards overview={overview} />

          <section className="finance-panel recurring-accounts-panel">
            <header className="recurring-accounts-header">
              <div>
                <p className="eyebrow">Organização mensal</p>
                <h2>Contas recorrentes</h2>
                <p>
                  Acompanhe suas despesas fixas e as obrigações recorrentes
                  de seus dependentes.
                </p>
              </div>
              <button
                className="recurring-mobile-filter"
                type="button"
                onClick={() => setModal({ kind: "recurring-filters" })}
              >
                Filtros · {recurringFilterLabels[recurringFilter]}
              </button>
            </header>
            <div className="recurring-filter-bar" aria-label="Filtrar contas recorrentes">
              {(Object.keys(recurringFilterLabels) as RecurringCommitmentFilter[])
                .map(filter => (
                  <button
                    type="button"
                    className={recurringFilter === filter ? "active" : ""}
                    aria-pressed={recurringFilter === filter}
                    key={filter}
                    onClick={() => setRecurringFilter(filter)}
                  >
                    {recurringFilterLabels[filter]}
                  </button>
                ))}
            </div>
            {recurringGroups.length ? (
              <div className="recurring-groups">
                {recurringGroups.map(group => (
                  <section
                    className="recurring-group"
                    key={`${group.groupType}:${group.personId ?? group.contextId ?? "own"}`}
                  >
                    <header>
                      <div>
                        <h3>{group.contextName}</h3>
                        <span>{group.items.length} conta{group.items.length === 1 ? "" : "s"}</span>
                      </div>
                      <strong>{money(group.total)} <small>por mês</small></strong>
                    </header>
                    <div className="recurring-account-list">
                      {group.items.map(item => (
                        <button
                          type="button"
                          key={item.commitmentId}
                          onClick={() => openRecurringDetails(item)}
                        >
                          <span className="recurring-account-main">
                            <b>{item.title}</b>
                            <small>
                              {[item.personName ?? item.contextName, item.categoryName]
                                .filter(Boolean).join(" · ") || "Sem categoria"}
                            </small>
                          </span>
                          <span>
                            <small>Valor do mês</small>
                            <b>{money(item.amountCents)}</b>
                          </span>
                          <span>
                            <small>Vencimento</small>
                            <b>{item.dueDay ? `Dia ${item.dueDay}` : date(item.dueDate)}</b>
                          </span>
                          <span>
                            <small>Pagamento</small>
                            <b>{paymentMethodLabels[item.paymentMethod ?? ""] ?? "Não definido"}</b>
                            <em>{item.accountName ?? item.cardName ?? "Sem instrumento"}</em>
                          </span>
                          <span>
                            <small>Frequência</small>
                            <b>{frequencyLabels[item.frequency ?? ""] ?? "Recorrente"}</b>
                          </span>
                          <span className={`recurring-status status-${item.status}`}>
                            {item.isPayrollDeduction
                              ? commitmentOccurrenceStatusLabel(
                                item.status === "pending" ? "expected" : item.status,
                                true,
                              )
                              : recurringStatusLabels[item.status]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : overview.recurring.occurrences.length ? (
              <div className="commitment-empty recurring-filter-empty">
                <h3>Nenhuma conta neste filtro</h3>
                <p>Escolha outro filtro para visualizar suas recorrências.</p>
                <button type="button" onClick={() => setRecurringFilter("all")}>
                  Mostrar todas
                </button>
              </div>
            ) : (
              <div className="commitment-empty">
                <h3>Nenhuma conta recorrente cadastrada</h3>
                <p>
                  Cadastre despesas fixas próprias, da casa ou de dependentes
                  para acompanhar seus compromissos mensais.
                </p>
                <button
                  className="finance-button"
                  type="button"
                  onClick={() => setModal({ kind: "commitment-create" })}
                >
                  Adicionar compromisso
                </button>
              </div>
            )}
          </section>

          <section className="finance-panel recurring-upcoming-panel">
            <header>
              <div>
                <p className="eyebrow">Agenda pontual</p>
                <h2>PrÃ³ximos pagamentos Ãºnicos</h2>
              </div>
            </header>
            {upcomingOneTime.length ? (
              <div className="commitment-list">
                {upcomingOneTime.slice(0, 5).map(item => (
                  <button key={item.commitment.id} onClick={() => openDetails(item)}>
                    <span>
                      <b>{item.commitment.title}</b>
                      <small>
                        {item.people.map(person => person.name).join(", ") ||
                          "Pessoal"} Â· {date(
                            item.currentOccurrence?.expectedDueDate ?? null,
                          )}
                      </small>
                    </span>
                    <span>
                      <strong>{money(
                        item.currentOccurrence?.expectedAmountCents ?? 0,
                      )}</strong>
                      <small>{commitmentOccurrenceStatusLabel(
                        item.currentOccurrence?.status ?? "",
                      )}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="commitment-empty compact">
                <p>Nenhum pagamento Ãºnico prÃ³ximo.</p>
              </div>
            )}
          </section>

          <section className="finance-panel recurring-upcoming-panel">
            <header>
              <div><p className="eyebrow">Agenda</p><h2>Próximos vencimentos</h2></div>
              {upcomingRecurring.length > 5 ? (
                <button type="button" onClick={() => setShowAllDue(value => !value)}>
                  {showAllDue ? "Mostrar menos" : "Ver todos"}
                </button>
              ) : null}
            </header>
            {upcomingRecurring.length ? (
              <div className="commitment-list">
                {upcomingRecurring.slice(0, showAllDue ? undefined : 5).map(item => (
                  <button key={item.commitment.id} onClick={() => openDetails(item)}>
                    <span>
                      <b>{item.commitment.title}</b>
                      <small>
                        {item.people.map(person => person.name).join(", ") ||
                          item.commitment.analysisGroupName ||
                          "Minha conta"} · {date(item.nextOccurrence?.expectedDueDate ?? null)}
                      </small>
                    </span>
                    <span>
                      <strong>{money(item.nextOccurrence?.expectedAmountCents ?? 0)}</strong>
                      <small className={`status-${item.nextOccurrence?.status}`}>
                        {commitmentOccurrenceStatusLabel(
                          item.nextOccurrence?.status ?? "",
                          item.commitment.isPayrollDeduction,
                        )}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="commitment-empty compact">
                <h3>Nenhum vencimento pendente</h3>
                <p>Não há ocorrências futuras ou atrasadas neste período.</p>
              </div>
            )}
          </section>

          <section className="finance-panel recurring-people-panel">
            <header>
              <div><p className="eyebrow">Pessoas e dependentes</p><h2>Gastos por pessoa</h2></div>
            </header>
            {peopleWithSpend.length ? (
              <div className="commitment-people-compact">
                {peopleWithSpend.map(item => {
                  const recurringForecast = overview.recurring.groups
                    .find(group => group.personId === item.person.id)?.total ?? 0;
                  return (
                    <button key={item.person.id} onClick={() => setModal({ kind: "person-details", item })}>
                      <i>{item.person.name.slice(0, 1).toUpperCase()}</i>
                      <span>
                        <b>{item.person.name}</b>
                        <small>
                          {relationLabel(item.person.relationType)}
                          {recurringForecast
                            ? ` · recorrente previsto ${money(recurringForecast)}`
                            : ""}
                        </small>
                      </span>
                      <strong>{money(personSpends[item.person.id]?.netSpent ?? 0)}</strong>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="commitment-empty compact">
                <h3>Sem gastos por pessoa neste mês</h3>
                <p>Somente pessoas reais com valores realizados aparecerão aqui.</p>
              </div>
            )}
          </section>

          {overview.recurring.warnings.length ? (
            <section className="commitment-alerts recurring-alerts">
              <h2>Atenção</h2>
              {overview.recurring.warnings.map(alert => <p key={alert}>{alert}</p>)}
            </section>
          ) : null}

          {suggestions.length ? (
            <section className="finance-panel commitment-suggestions">
              <header>
                <div><p className="eyebrow">Sugestões não cadastradas</p><h2>Possíveis recorrências</h2></div>
              </header>
              {suggestions.map(item =>
                <article key={item.fingerprint}>
                  <span>
                    <b>{item.merchant}</b>
                    <small>{item.occurrenceCount} ocorrências · confiança {Math.round(item.confidence * 100)}%</small>
                  </span>
                  <strong>{money(item.averageAmountCents)}</strong>
                  <div>
                    <button onClick={() => setModal({ kind: "commitment-create" })}>Criar recorrência</button>
                    <form action={rejectRecurringSuggestion}>
                      <input type="hidden" name="workspace_id" value={overview.workspaceId} />
                      <input type="hidden" name="fingerprint" value={item.fingerprint} />
                      <button>Não sugerir</button>
                    </form>
                  </div>
                </article>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {activeTab === "recurring" ? (
        <section className="finance-panel commitment-recurring-panel">
          <header>
            <div><p className="eyebrow">{recurring.length} compromissos</p><h2>Compromissos recorrentes</h2></div>
          </header>
          {recurring.length ? (
            <div className="commitment-table">
              {recurring.map(item =>
                <button key={item.commitment.id} onClick={() => openDetails(item)}>
                  <span>
                    <b>{item.commitment.title}</b>
                    <small>{item.categoryName ?? "Sem categoria"} · {item.people.map(person => person.name).join(", ") || "Sem pessoa"}</small>
                  </span>
                  <span>{item.commitment.recurrenceFrequency ?? "—"}</span>
                  <span>{date(item.nextOccurrence?.expectedDueDate ?? null)}</span>
                  <strong>{money(item.commitment.expectedAmountCents ?? 0)}</strong>
                  <em className={`status-${item.currentOccurrence?.status ?? item.commitment.status}`}>
                    {commitmentOccurrenceStatusLabel(
                      item.currentOccurrence?.status ?? item.commitment.status,
                      item.commitment.isPayrollDeduction,
                    )}
                  </em>
                </button>
              )}
            </div>
          ) : (
            <div className="commitment-empty">
              <h3>Nenhuma recorrência encontrada</h3>
              <p>Crie uma obrigação recorrente para gerar projeções.</p>
              <button className="finance-button" onClick={() => setModal({ kind: "commitment-create", personId: personFilter || undefined })}>
                Nova recorrência
              </button>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "people" ? (
        <section className="commitment-people-grid">
          {overview.people.length ? overview.people
            .filter(item => item.person.relationType !== "self")
            .map(item =>
            <button
              type="button"
              className="finance-panel commitment-person-card"
              key={item.person.id}
              onClick={() => setModal({ kind: "person-details", item })}
            >
              <header>
                <span>
                  <i>{item.person.name.slice(0, 1).toUpperCase()}</i>
                  <b>{item.person.name}</b>
                  <small>{relationLabel(item.person.relationType)}{item.person.isDependent ? " · dependente financeiro" : ""}</small>
                </span>
                <em>{item.person.isActive ? "Ativa" : "Arquivada"}</em>
              </header>
              <dl>
                <div><dt>Gasto líquido</dt><dd>{money(personSpends[item.person.id]?.netSpent ?? 0)}</dd></div>
                <div><dt>Recorrente</dt><dd>{money(personSpends[item.person.id]?.recurringSpent ?? 0)}</dd></div>
                <div><dt>Extraordinário</dt><dd>{money(personSpends[item.person.id]?.extraordinarySpent ?? 0)}</dd></div>
                <div><dt>Futuro</dt><dd>{money(personSpends[item.person.id]?.futureCommitments ?? 0)}</dd></div>
              </dl>
              <p>Próximo: {item.nextCommitment ?? "nenhum"}</p>
              <span className="person-card-details">Ver detalhes</span>
            </button>
          ) : (
            <div className="finance-panel commitment-empty">
              <h3>Nenhuma pessoa cadastrada</h3>
              <p>Cadastre pessoas ou dependentes para acompanhar gastos individuais.</p>
              <button className="finance-button" onClick={() => setModal({ kind: "person-create" })}>
                Adicionar pessoa
              </button>
            </div>
          )}
        </section>
      ) : null}

      {toast ? <div className="atlas-toast" role="status">{toast}</div> : null}

      <AtlasModal
        open={modal !== null}
        onClose={dismissModal}
        size={modal?.kind === "confirm"
          ? "small"
          : modal?.kind === "recurring-filters"
            ? "small"
          : modal?.kind === "commitment-create"
            ? "medium"
          : modal?.kind.includes("commitment") ||
              modal?.kind === "person-details"
            ? "large"
            : "medium"}
        title={modal?.kind === "confirm"
          ? modal.title
          : modal?.kind === "recurring-filters"
            ? "Filtros"
            : modal?.kind.includes("person")
              ? "Pessoa"
              : "Compromisso"}
        closeOnBackdrop={modal?.kind !== "confirm"}
        focusKey={modal?.kind}
      >
        {modal?.kind === "recurring-filters" ? (
          <div className="recurring-filter-modal">
            <header>
              <p className="eyebrow">Contas recorrentes</p>
              <h2>Escolha o que deseja ver</h2>
            </header>
            <div>
              {(Object.keys(recurringFilterLabels) as RecurringCommitmentFilter[])
                .map(filter => (
                  <button
                    type="button"
                    className={recurringFilter === filter ? "active" : ""}
                    key={filter}
                    onClick={() => {
                      setRecurringFilter(filter);
                      closeModal();
                    }}
                  >
                    {recurringFilterLabels[filter]}
                  </button>
                ))}
            </div>
            <button type="button" onClick={closeModal}>Cancelar</button>
          </div>
        ) : null}
        {modal?.kind === "commitment-create" ? (
          <SimpleCommitmentModal
            workspaceId={overview.workspaceId}
            categories={categories}
            accounts={accounts}
            cards={cards}
            people={overview.people}
            initialPersonId={modal.personId}
            onClose={closeModal}
            onMessage={setToast}
          />
        ) : null}
        {modal?.kind === "commitment-edit" ? (
          <CommitmentForm
            workspaceId={overview.workspaceId}
            categories={categories}
            accounts={accounts}
            cards={cards}
            householdGroups={householdGroups}
            people={overview.people}
            item={modal.item}
            onClose={closeModal}
            onSaved={onSaved}
          />
        ) : null}
        {modal?.kind === "commitment-amount" ? (
          <CommitmentAmountForm
            workspaceId={overview.workspaceId}
            item={modal.item}
            occurrence={modal.occurrence}
            onClose={() => setModal({
              kind: "commitment-details",
              item: modal.item,
            })}
            onSaved={onSaved}
          />
        ) : null}
        {modal?.kind === "person-create" ? (
          <PersonForm workspaceId={overview.workspaceId} onClose={closeModal} onSaved={onSaved} />
        ) : null}
        {modal?.kind === "person-edit" ? (
          <PersonForm workspaceId={overview.workspaceId} item={modal.item} onClose={closeModal} onSaved={onSaved} />
        ) : null}
        {modal?.kind === "commitment-details" ? (
          <CommitmentDetails
            item={modal.item}
            workspaceId={overview.workspaceId}
            availablePeople={overview.people}
            onEdit={() => setModal({ kind: "commitment-edit", item: modal.item })}
            onEditAmount={occurrence => setModal({
              kind: "commitment-amount",
              item: modal.item,
              occurrence,
            })}
            onConfirm={input => openConfirmation(input, modal.item)}
          />
        ) : null}
        {modal?.kind === "person-details" ? (
          <PersonDetails
            item={modal.item}
            dashboardData={personDashboards[modal.item.person.id]}
            referenceMonth={month}
            relationLabel={relationLabel}
            onEdit={() => setModal({ kind: "person-edit", item: modal.item })}
            onAddCommitment={() => setModal({ kind: "commitment-create", personId: modal.item.person.id })}
            onArchive={() => setModal({
              kind: "confirm",
              title: "Arquivar pessoa?",
              description: "Ela deixará de aparecer nas listas ativas. Os vínculos históricos serão preservados.",
              confirmLabel: "Arquivar",
              action: archiveFinancialPerson,
              fields: {
                workspace_id: overview.workspaceId,
                person_id: modal.item.person.id,
              },
              returnTo: { kind: "person-details", item: modal.item },
            })}
          />
        ) : null}
        {modal?.kind === "confirm" ? (
          <ConfirmAction
            config={modal}
            onCancel={dismissModal}
            onSuccess={() => {
              closeModal();
              setToast("Ação concluída com sucesso.");
              router.refresh();
            }}
          />
        ) : null}
      </AtlasModal>
    </div>
  );
}
