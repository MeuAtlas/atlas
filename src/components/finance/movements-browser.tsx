"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Money } from "./value-visibility";
import {
  buildMovementFiltersUrl,
  buildMovementQueryKey,
  calculateMovementSummaryByFilter,
  groupMovementsByDate,
  navigateIfChanged,
  type MovementFilters,
  type MovementFilterSummary,
  type MovementListItem,
  type MovementPeriodSummary,
  type MovementSourceFilter,
} from "@/modules/finance/movement-filters";
import { useNavigationTransition } from "@/components/navigation/navigation-feedback";
import { useClientNavigation } from "@/components/navigation/client-navigation";
import type { AvailableCardCycle } from "@/modules/finance/card-cycles";
import type {
  InstallmentsDataStatus,
} from "@/modules/finance/open-card-cycle";
import type { ResolvedOpenCardInvoice } from "@/modules/finance/open-card-invoice";
import {
  formatMoneyByCurrency,
  implicitExchangeRate,
} from "@/modules/finance/foreign-card-movement";
import {
  buildCardMovementsViewModel,
  formatInstallmentLabel,
} from "@/modules/finance/card-movements-view-model";
import { correctForeignCardMovementAmounts } from "@/modules/finance/actions";
import {
  confirmCommitmentMatch,
  linkCardMovementToOccurrence,
  linkTransactionToOccurrence,
  rejectCommitmentMatch,
  transformTransactionIntoRecurringCommitment,
} from "@/modules/finance/commitments-actions";
import {
  linkMovementSourceToPersonAction,
  unlinkMovementSourceFromPersonAction,
} from "@/modules/finance/movement-person-actions";
import type {
  MovementPersonContext,
} from "@/modules/finance/person-reimbursements-query";
import {
  createExpenseEstablishmentAction,
  unlinkExpenseEstablishmentAction,
} from "@/modules/finance/expense-establishments-actions";
import type {
  ExpenseEstablishmentContext,
} from "@/modules/finance/expense-establishments";

type Option = { id: string; name: string; parentId?: string };
type CommitmentMatchView = {
  transactionId: string;
  occurrenceId: string;
  commitmentId: string;
  title: string;
  score: number;
  decision: string;
  reasons: string[];
};
type OpenCycleBreakdownView = {
  newPurchasesTotal: number | null;
  postedInstallmentsTotal: number | null;
  projectedUnpostedInstallmentsTotal: number | null;
  feesAndTaxesTotal: number | null;
  creditsAndRefundsTotal: number | null;
  detailedTotal: number | null;
  confirmedOpenTotal: number | null;
  reconciliationDifference: number | null;
  installmentsDataStatus: InstallmentsDataStatus;
};

function queryHref(filters: MovementFilters, patch: Record<string, string | null>) {
  return buildMovementFiltersUrl(filters, patch, {
    preservePage: patch.page != null,
  });
}

function formatGroupDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function movementStatusLabel(status: string) {
  const labels: Record<string, string> = {
    realized: "Realizado",
    pending: "Pendente",
    projected: "Previsto",
    cancelled: "Cancelado",
    disputed: "Em contestação",
  };
  return labels[status] ?? status;
}

function financialRoleLabel(role: string | null | undefined) {
  const labels: Record<string, string> = {
    revenue: "Receita",
    expense: "Despesa",
    transfer: "Transferência",
    investment_principal: "Movimentação de investimento",
    investment_income: "Rendimento",
    loan_principal: "Principal de empréstimo",
    fee: "Tarifa",
    refund: "Estorno",
  };
  return role ? labels[role] ?? role : "Não informado";
}

function SummaryCards({
  summary,
  cycle,
  breakdown,
  resolvedInvoice,
}: {
  summary: MovementFilterSummary;
  cycle?: AvailableCardCycle | null;
  breakdown?: OpenCycleBreakdownView | null;
  resolvedInvoice?: ResolvedOpenCardInvoice | null;
}) {
  if (summary.mode === "all") {
    return (
      <aside className="movement-all-context" role="note">
        <strong>Pesquisa geral</strong>
        <span>
          Esta visão reúne conta corrente, cartões e ajustes apenas para localizar
          lançamentos. Os totais financeiros aparecem nas visões específicas.
        </span>
      </aside>
    );
  }
  const isClosedCycle = Boolean(
    cycle && ["closed", "paid"].includes(cycle.kind),
  );
  const isConfirmedClosedCycle = Boolean(
    isClosedCycle && cycle?.officialTotal !== null,
  );
  const isOfficialTotalPending = Boolean(
    isClosedCycle && cycle?.source !== "pdf" && cycle?.officialTotal === null,
  );
  return (
    <div className="movement-summary-shell">
      <section className="movement-summary" aria-label="Resumo do período">
        {(summary.mode === "card" && breakdown
          ? [
            {
              label: "Projeção Pluggy",
              value: breakdown.detailedTotal ?? null,
              tone: "neutral" as const,
              signed: false,
            },
            {
              label: "Compras à vista",
              value: breakdown.newPurchasesTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Compras parceladas",
              value: breakdown.postedInstallmentsTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Encargos e IOF",
              value: breakdown.feesAndTaxesTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Créditos e estornos",
              value: breakdown.creditsAndRefundsTotal ?? null,
              tone: "positive" as const,
              signed: false,
            },
            {
              label: "Diferença para o total",
              value: breakdown.reconciliationDifference,
              tone: "neutral" as const,
              signed: false,
            },
          ]
          : summary.cards).map(card => (
          <article key={card.label}>
            <span>{card.label}</span>
            {card.value === null
              ? <strong className="movement-value-unavailable">Valor indisponível</strong>
              : <Money
                value={card.value}
                signed={card.signed}
                className={card.tone}
              />}
          </article>
        ))}
      </section>
      {summary.mode === "card" && cycle ? (
        <aside className="movement-card-official-summary">
          <span>{cycle.source === "pdf"
            ? "Confirmada por PDF"
            : isConfirmedClosedCycle
              ? "Bill oficial Pluggy"
              : isOfficialTotalPending
                ? "Fechamento oficial pendente"
                : "Conciliação da fatura aberta"}</span>
          {isConfirmedClosedCycle ? (
            <>
              <span>Pagamentos <Money value={cycle.paymentsTotal ?? 0} /></span>
              <span>Saldo anterior <Money value={cycle.previousBalance ?? 0} /></span>
              <span>
                Diferença{" "}
                {cycle.reconciliationDifference === null
                  ? "não informada"
                  : <Money value={cycle.reconciliationDifference} signed />}
              </span>
            </>
          ) : isOfficialTotalPending ? (
            <span>
              A Pluggy ainda não enviou o valor oficial de fechamento desta fatura.
            </span>
          ) : (
            <>
              {breakdown ? (
                <>
                  <span>Movimentações: somente Pluggy</span>
                  <span>Atualiza após cada sincronização</span>
                </>
              ) : null}
              <span>
                {resolvedInvoice?.detailsCompleteness === "complete"
                  ? "Dados sincronizados"
                  : "Detalhamento parcial"}
              </span>
            </>
          )}
          <span>
            Fonte: {resolvedInvoice?.sourceLabel ??
              (cycle.source === "pdf"
                ? "PDF confirmado"
                : cycle.source === "pluggy_bill"
                  ? "Bill Pluggy"
                  : isOfficialTotalPending
                    ? "Pluggy — fechamento oficial pendente"
                  : cycle.source === "manual"
                    ? "Manual"
                    : "Calculada")}
          </span>
          {resolvedInvoice?.confirmedAt ? (
            <span>
              Última confirmação:{" "}
              {formatShortDate(resolvedInvoice.confirmedAt.slice(0, 10))}
            </span>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}

function MovementViewTabs({
  filters,
  defaultCardCycleId,
}: {
  filters: MovementFilters;
  defaultCardCycleId: string | null;
}) {
  const navigate = useClientNavigation();
  const type = (filters.type || "bank") as MovementSourceFilter;
  const views: Array<{ value: "bank" | "card"; label: string }> = [
    {
      value: "bank",
      label: "Conta corrente",
    },
    {
      value: "card",
      label: "Cartões",
    },
  ];
  return (
    <nav className="movement-view-tabs" aria-label="Visão das movimentações">
      {views.map(view => {
        const active = type === view.value;
        return (
          <button
            key={view.value}
            type="button"
            className={active ? "active" : undefined}
            aria-pressed={active}
            onClick={() => navigate(buildMovementFiltersUrl(filters, {
              type: view.value,
              period: view.value === "bank"
                ? filters.period || "this-month"
                : null,
              card: view.value === "bank" ? null : filters.card,
              cycle: view.value === "card"
                ? filters.cycle || defaultCardCycleId
                : null,
            }))}
          >
            {view.label}
          </button>
        );
      })}
    </nav>
  );
}

export function MovementTypeSelect({
  value,
  onChange,
}: {
  value: MovementSourceFilter;
  onChange: (value: MovementSourceFilter) => void;
}) {
  return (
    <label>
      <span>Tipo</span>
      <select
        name="type"
        value={value}
        onChange={event => onChange(event.target.value as MovementSourceFilter)}
      >
        <option value="all">Todas</option>
        <option value="bank">Conta bancária</option>
        <option value="card">Cartões</option>
        <option value="transfer">Transferências</option>
        <option value="adjustment">Ajustes</option>
      </select>
    </label>
  );
}

export function BankPeriodSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="movement-bank-period">
      <span>Período</span>
      <select name="period" value={value} onChange={event => onChange(event.target.value)}>
        <option value="this-month">Este mês</option>
        <option value="last-month">Mês passado</option>
        <option value="last-30-days">Últimos 30 dias</option>
        <option value="last-3-months">Últimos 3 meses</option>
        <option value="this-year">Este ano</option>
        <option value="custom">Personalizado</option>
      </select>
    </label>
  );
}

function cycleStatusLabel(cycle: AvailableCardCycle) {
  if (cycle.kind === "estimated") return "Projeção";
  if (cycle.status === "open") return "Aberta";
  if (cycle.status === "paid") return "Paga";
  if (cycle.status === "overdue") return "Vencida";
  if (cycle.status === "closed") return "Fechada";
  return "Status desconhecido";
}

function cycleMilestoneLabel(cycle: AvailableCardCycle) {
  const due = cycle.dueDate
    ? `Vence ${formatShortDate(cycle.dueDate)}`
    : null;
  if (cycle.status === "open") {
    return [
      due,
      cycle.closingDate
        ? `fecha ${formatShortDate(cycle.closingDate)}`
        : null,
    ].filter(Boolean).join(" · ") || "Em aberto";
  }
  return due;
}

export function cycleCardLabel(cycle: AvailableCardCycle) {
  const lastFour = cycle.cardLabel.match(/(?:final\s*)?(\d{4})\b/i)?.[1];
  const family = /\bVISA\b/i.test(cycle.cardLabel)
    ? "Visa"
    : /\b(?:MC|MASTER|MASTERCARD)\b/i.test(cycle.cardLabel)
      ? "Mastercard"
      : "Cartão";
  return `${family}${lastFour ? ` • ${lastFour}` : ""}`;
}

function cycleMonthLabel(cycle: AvailableCardCycle) {
  // O mês da fatura é o mês de referência/fechamento. O vencimento
  // pode ocorrer no mês seguinte e não deve deslocar a fatura no seletor.
  const value = cycle.referenceMonth ?? cycle.cycleEndDate;
  const [year, month] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function cycleGroupLabel(cycle: AvailableCardCycle) {
  const month = cycleMonthLabel(cycle);
  return cycle.status === "open" ? `${month} · em aberto` : month;
}

export function cycleOptionLabel(
  cycle: AvailableCardCycle,
  includeClosingDate = false,
) {
  const status = cycleStatusLabel(cycle);
  const dayMonth = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  const details = [
    cycle.dueDate ? `vence ${dayMonth(cycle.dueDate)}` : null,
    status,
    includeClosingDate && cycle.closingDate
      ? `fecha ${dayMonth(cycle.closingDate)}`
      : null,
  ].filter(Boolean);
  return `${cycleCardLabel(cycle)} · ${details.join(" · ")}`;
}

export function CardBillSelect({
  value,
  cycles,
  onChange,
}: {
  value: string;
  cycles: AvailableCardCycle[];
  onChange: (value: string) => void;
}) {
  const groups = Map.groupBy(cycles, cycleGroupLabel);
  const optionCollisions = new Map<string, number>();
  for (const cycle of cycles) {
    const key = `${cycleCardLabel(cycle)}|${cycle.dueDate ?? ""}`;
    optionCollisions.set(key, (optionCollisions.get(key) ?? 0) + 1);
  }
  return (
    <label className="movement-card-bill">
      <span>Fatura</span>
      <select name="cycle" value={value} onChange={event => onChange(event.target.value)}>
        {[...groups.entries()].map(([group, groupCycles]) => (
          <optgroup label={group} key={group}>
            {groupCycles.map(cycle => (
              <option value={cycle.cycleId} key={cycle.cycleId}>
                {cycleOptionLabel(
                  cycle,
                  (optionCollisions.get(
                    `${cycleCardLabel(cycle)}|${cycle.dueDate ?? ""}`,
                  ) ?? 0) > 1,
                )}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function CardFilterSelect({
  value,
  cards,
  onChange,
}: {
  value: string;
  cards: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="movement-card-filter">
      <span>Cartão</span>
      <select name="card" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">Todos os cartões desta fatura</option>
        {cards.map(card => <option value={card.id} key={card.id}>{card.name}</option>)}
      </select>
    </label>
  );
}

function MovementFiltersForm({
  filters,
  accounts,
  cards,
  cardCycles,
  categories,
  people,
}: {
  filters: MovementFilters;
  accounts: Option[];
  cards: Option[];
  cardCycles: AvailableCardCycle[];
  categories: Option[];
  people: Option[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useNavigationTransition();
  const [period, setPeriod] = useState(filters.period || "this-month");
  const type = (filters.type || "bank") as MovementSourceFilter;
  const defaultCycle = cardCycles.find(cycle => cycle.isCurrent)?.cycleId ??
    cardCycles[0]?.cycleId ?? "";
  const [cycleId, setCycleId] = useState(filters.cycle || defaultCycle);
  const [cardId, setCardId] = useState(filters.card || "");
  const selectedCycle = cardCycles.find(cycle => cycle.cycleId === cycleId);
  const cycleCards = selectedCycle
    ? cards.filter(card =>
      selectedCycle.cardIds.includes(card.parentId ?? card.id))
    : cards;
  const advancedCount = [
    filters.category,
    filters.nature,
    filters.person,
    filters.origin,
    filters.status,
    filters.review,
    type === "card" ? null : filters.card,
    filters.ignored,
    filters.uncategorized,
    filters.document,
    filters.purchaseType,
    filters.minAmount,
    filters.maxAmount,
  ].filter(Boolean).length;
  return (
    <form
      className="movement-filter-shell"
      onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const patch: Record<string, string | null> = {};
        values.forEach((value, key) => {
          patch[key] = typeof value === "string" && value ? value : null;
        });
        const nextPath = buildMovementFiltersUrl({}, patch);
        const currentPath = `${window.location.pathname}${window.location.search}`;
        startTransition(() => {
          navigateIfChanged(router, currentPath, nextPath);
        });
      }}
    >
      <div className="movement-main-filters">
        <input type="hidden" name="type" value={type} />
        <label className="movement-search">
          <span>Busca</span>
          <input
            name="search"
            defaultValue={filters.search || filters.q || ""}
            placeholder="Buscar movimentação"
          />
        </label>
        {type === "card" ? (
          cardCycles.length ? (
            <CardBillSelect value={cycleId} cycles={cardCycles} onChange={value => {
              setCycleId(value);
              setCardId("");
            }} />
          ) : <div className="movement-cycle-inline-empty">Nenhuma fatura disponível</div>
        ) : (
          <>
            <BankPeriodSelect value={period} onChange={setPeriod} />
            <label>
              <span>{type === "bank" ? "Conta" : "Conta (opcional)"}</span>
              <select name="account" defaultValue={filters.account || ""}>
                <option value="">Todas as contas</option>
                {accounts.map(account => <option value={account.id} key={account.id}>{account.name}</option>)}
              </select>
            </label>
          </>
        )}
        {type === "card" && cycleCards.length > 1 ? (
          <CardFilterSelect value={cardId} cards={cycleCards} onChange={setCardId} />
        ) : null}
        <button type="submit" disabled={isPending} className="finance-button movement-apply">
          {isPending ? "Aplicando..." : "Aplicar"}
        </button>
        <Link className="movement-clear" href="/financeiro/movimentacoes">Limpar</Link>
      </div>
      {type !== "card" && period === "custom" ? (
        <div className="movement-custom-period">
          <label><span>De</span><input type="date" name="from" required defaultValue={filters.from} /></label>
          <label><span>Até</span><input type="date" name="to" required defaultValue={filters.to} /></label>
        </div>
      ) : null}
      <details className="movement-advanced" open={advancedCount > 0}>
        <summary>Mais filtros{advancedCount ? ` • ${advancedCount}` : ""}</summary>
        <div>
          <label><span>Categoria</span><select name="category" defaultValue={filters.category || ""}>
            <option value="">Todas</option>
            {categories.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select></label>
          <label><span>Natureza</span><select name="nature" defaultValue={filters.nature || ""}>
            <option value="">Todas</option><option value="income">Receita</option>
            <option value="expense">Despesa</option><option value="reimbursement">Reembolso</option>
            <option value="refund">Estorno</option><option value="transfer">Transferência</option>
            <option value="neutral">Neutro</option>
          </select></label>
          <label><span>Pessoa</span><select name="person" defaultValue={filters.person || ""}>
            <option value="">Todas</option>
            {people.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}
          </select></label>
          <label><span>Origem</span><select name="origin" defaultValue={filters.origin || ""}>
            <option value="">Todas</option><option value="pluggy">Pluggy</option><option value="manual">Manual</option>
          </select></label>
          <label><span>Status</span><select name="status" defaultValue={filters.status || ""}>
            <option value="">Todos</option><option value="realized">Realizado</option>
            <option value="pending">Pendente</option><option value="forecast">Previsto</option>
          </select></label>
          {type === "card" ? <label><span>Tipo de compra</span><select name="purchaseType" defaultValue={filters.purchaseType || ""}>
            <option value="">Todas</option><option value="installment">Parceladas</option>
            <option value="regular">Do per&iacute;odo</option>
          </select></label> : null}
          {type !== "card" ? <label><span>Cartão</span><select name="card" defaultValue={filters.card || ""}>
            <option value="">Todos</option>
            {cards.map(card => <option value={card.id} key={card.id}>{card.name}</option>)}
          </select></label> : null}
          <label><span>Valor mínimo</span><input name="minAmount" inputMode="decimal" defaultValue={filters.minAmount || ""} /></label>
          <label><span>Valor máximo</span><input name="maxAmount" inputMode="decimal" defaultValue={filters.maxAmount || ""} /></label>
          <label className="movement-check"><input type="checkbox" name="review" value="pending" defaultChecked={filters.review === "pending"} /> Revisão pendente</label>
          <label className="movement-check"><input type="checkbox" name="uncategorized" value="true" defaultChecked={filters.uncategorized === "true"} /> Somente não categorizadas</label>
          <label className="movement-check"><input type="checkbox" name="ignored" value="true" defaultChecked={filters.ignored === "true"} /> Somente ignoradas</label>
          <label className="movement-check"><input type="checkbox" name="document" value="linked" defaultChecked={filters.document === "linked"} /> Com documento vinculado</label>
        </div>
      </details>
    </form>
  );
}

function CurrentCardCyclesOverview({
  cycles,
  selectedCycle,
}: {
  cycles: AvailableCardCycle[];
  selectedCycle: AvailableCardCycle | null;
}) {
  const currentCycles = cycles.filter(cycle => cycle.isCurrent);
  if (!currentCycles.length) return null;
  return (
    <section className="movement-card-cycle-overview" aria-labelledby="current-card-cycles">
      <header>
        <div>
          <span>Em aberto</span>
          <h2 id="current-card-cycles">Faturas abertas</h2>
        </div>
        <p>Selecione uma fatura.</p>
      </header>
      <div>
        {currentCycles.map(cycle => (
          <Link
            key={cycle.cycleId}
            href={queryHref({ type: "card" }, { cycle: cycle.cycleId })}
            className={selectedCycle?.cycleId === cycle.cycleId ? "active" : undefined}
          >
            <span>{cycleCardLabel(cycle)}</span>
            <strong>{cycle.officialTotal === null ? "Valor em conciliação" : <Money value={cycle.officialTotal} />}</strong>
            <small>{cycleMilestoneLabel(cycle) ?? cycleStatusLabel(cycle)}</small>
          </Link>
        ))}
      </div>
    </section>
  );
}

function exceptionLabels(item: MovementListItem) {
  return [
    item.reviewRequired ? "Revisar" : null,
    item.isIgnored ? "Ignorada da análise" : null,
    item.manuallyAdjusted ? "Ajustada manualmente" : null,
    item.dataCompleteness === "partial" ? "Dados incompletos" : null,
  ].filter((value): value is string => Boolean(value));
}

function MovementRow({
  item,
  personContext,
  onOpen,
}: {
  item: MovementListItem;
  personContext?: MovementPersonContext;
  onOpen: (item: MovementListItem, trigger: HTMLButtonElement) => void;
}) {
  const exceptions = exceptionLabels(item);
  const originalMoney = item.isForeignTransaction &&
    item.originalAmount !== null &&
    item.originalCurrencyCode
    ? formatMoneyByCurrency(item.originalAmount, item.originalCurrencyCode)
    : null;
  const convertedMoney = item.amountBrl === null
    ? null
    : formatMoneyByCurrency(item.amountBrl, "BRL");
  const signedValue = item.consumptionEffect === "expense" || item.cashFlowEffect === "outflow"
    ? -(item.amountBrl ?? 0)
    : item.consumptionEffect === "income" || item.cashFlowEffect === "inflow"
      ? item.amountBrl ?? 0
      : 0;
  return (
    <button
      type="button"
      className={`movement-row movement-${item.direction}`}
      onClick={event => onOpen(item, event.currentTarget)}
      aria-label={[
        `Abrir detalhes de ${item.description}.`,
        item.amountBrl === null
          ? "Valor convertido indisponÃ­vel."
          : `Valor convertido: ${formatMoneyByCurrency(item.amountBrl, "BRL")}.`,
        originalMoney ? `Valor original: ${originalMoney}.` : "",
        item.installmentNumber && item.installmentTotal
          ? `Parcela ${item.installmentNumber} de ${item.installmentTotal}.`
          : "",
      ].filter(Boolean).join(" ")}
    >
      <span className="movement-row-main">
        <b>{item.description}</b>
        <small>
          {item.cardLabel || item.accountName}
          {item.accountMaskedIdentifier ? ` • ${item.accountMaskedIdentifier}` : ""}
          {item.provider === "Pluggy" ? " • Pluggy" : ""}
          {` • ${formatShortDate(item.date)}`}
          {item.installmentNumber && item.installmentTotal
            ? ` • Parcela ${item.installmentNumber} de ${item.installmentTotal}`
            : ""}
        </small>
        {exceptions.length ? <span className="movement-exceptions">
          {exceptions.map(label => <i key={label}>{label}</i>)}
        </span> : null}
        {personContext ? (
          <span className="movement-person-badges">
            <i>{personContext.personName}</i>
            <i>{item.direction === "inflow"
              ? "Entrou na conta"
              : item.direction === "outflow"
                ? "Saiu da conta"
                : "Movimento neutro"}</i>
          </span>
        ) : null}
      </span>
      <span className="movement-row-category">{item.categoryName}</span>
      <span className="movement-row-value">
        {originalMoney ? (
          <>
            <b className="movement-row-foreign-original">{originalMoney}</b>
            <small className="movement-row-converted">
              {convertedMoney
                ? `${convertedMoney} em reais`
                : "Conversão em reais indisponível"}
            </small>
          </>
        ) : item.amountBrl === null
          ? <b>Valor convertido indisponível</b>
          : item.direction === "card" || item.direction === "transfer" || item.direction === "adjustment"
            ? <Money value={item.amountBrl} />
            : <Money value={signedValue} signed />}
        <small>{item.displayType}</small>
      </span>
    </button>
  );
}

function CardMovementValue({ item }: { item: MovementListItem }) {
  if (item.amountBrl === null) return <span>Valor indispon&iacute;vel</span>;
  const value = item.consumptionEffect === "income"
    ? -Math.abs(item.amountBrl)
    : Math.abs(item.amountBrl);
  return <Money value={value} />;
}

function CardMovementRow({
  item,
  installment,
  onOpen,
}: {
  item: MovementListItem;
  installment: boolean;
  onOpen: (item: MovementListItem, trigger: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      className={`card-movement-row ${installment ? "is-installment" : "is-regular"}`}
      onClick={event => onOpen(item, event.currentTarget)}
      aria-label={`Abrir detalhes de ${item.description}, ${
        installment ? `parcela ${formatInstallmentLabel(item)}, ` : ""
      }${item.amountBrl === null ? "valor indispon\u00edvel" : formatMoneyByCurrency(item.amountBrl, "BRL")}`}
    >
      <span className="card-movement-launch">
        <b>{item.description}</b>
        <small>{"Cart\u00e3o \u00b7 "}{formatShortDate(item.date)}</small>
      </span>
      {installment ? <span className="card-movement-installment">{formatInstallmentLabel(item)}</span> : null}
      <span className="card-movement-value"><CardMovementValue item={item} /></span>
    </button>
  );
}

function CardMovementsSections({
  items,
  onOpen,
}: {
  items: MovementListItem[];
  onOpen: (item: MovementListItem, trigger: HTMLButtonElement) => void;
}) {
  const view = useMemo(() => buildCardMovementsViewModel(items), [items]);
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  const toggleDay = (date: string) => setCollapsedDays(current => {
    const next = new Set(current);
    if (next.has(date)) next.delete(date);
    else next.add(date);
    return next;
  });
  return <div className="card-movement-sections">
    {view.installments.length ? <section className="card-movement-section" aria-labelledby="installment-purchases-title">
      <h3 id="installment-purchases-title">Compras parceladas</h3>
      <div className="card-movement-table" role="table" aria-label="Compras parceladas">
        <div className="card-movement-table-head is-installment" role="row">
          <span role="columnheader">Lan&ccedil;amento</span>
          <span role="columnheader">Parcela</span>
          <span role="columnheader">Valor</span>
        </div>
        <div role="rowgroup">{view.installments.map(item => <CardMovementRow
          key={`${item.sourceKind}-${item.id}`}
          item={item}
          installment
          onOpen={onOpen}
        />)}</div>
      </div>
    </section> : null}
    {view.regular.length ? <section className="card-movement-section" aria-labelledby="period-purchases-title">
      <h3 id="period-purchases-title">Compras do per&iacute;odo</h3>
      <div className="card-movement-table" role="table" aria-label="Compras do período">
        <div className="card-movement-table-head is-regular" role="row">
          <span role="columnheader">Lan&ccedil;amento</span>
          <span role="columnheader">Valor</span>
        </div>
        {view.regularGroups.map(group => {
          const collapsed = collapsedDays.has(group.date);
          return <section className="card-movement-day" key={group.date}>
            <button
              type="button"
              className="card-movement-day-toggle"
              aria-expanded={!collapsed}
              aria-controls={`card-day-${group.date}`}
              onClick={() => toggleDay(group.date)}
            >
              <b>{formatGroupDate(group.date)}</b>
              <span>{group.items.length} {group.items.length === 1 ? "compra" : "compras"} &middot; total do dia <Money value={group.total} /></span>
              <i className={collapsed ? "is-collapsed" : undefined} aria-hidden="true">&rsaquo;</i>
            </button>
            <div id={`card-day-${group.date}`} hidden={collapsed}>
              {group.items.map(item => <CardMovementRow
                key={`${item.sourceKind}-${item.id}`}
                item={item}
                installment={false}
                onOpen={onOpen}
              />)}
            </div>
          </section>;
        })}
      </div>
    </section> : null}
  </div>;
}

function MovementDetailsDrawer({
  item,
  cycle,
  workspaceId,
  people,
  personContext,
  establishmentContext,
  categories,
  commitmentOccurrences,
  commitmentMatches,
  onClose,
}: {
  item: MovementListItem | null;
  cycle?: AvailableCardCycle | null;
  workspaceId: string | null;
  people: Option[];
  personContext?: MovementPersonContext;
  establishmentContext?: ExpenseEstablishmentContext;
  categories: Option[];
  commitmentOccurrences: Option[];
  commitmentMatches: CommitmentMatchView[];
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  const [counterpartyFeedback, setCounterpartyFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isCounterpartyPending, startCounterpartyTransition] = useTransition();
  const [establishmentFeedback, setEstablishmentFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isEstablishmentPending, startEstablishmentTransition] = useTransition();
  const [recurringFeedback, setRecurringFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [isRecurringPending, startRecurringTransition] = useTransition();
  const [commitmentFeedback, setCommitmentFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [
    commitmentReplacementRequired,
    setCommitmentReplacementRequired,
  ] = useState(false);
  const [isCommitmentPending, startCommitmentTransition] = useTransition();
  useEffect(() => {
    if (!item) return;
    const drawer = drawerRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (drawer) drawer.scrollTop = 0;
    const focusable = drawer?.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusable?.[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [item, onClose]);
  if (!item || typeof document === "undefined") return null;
  const cashLabel = item.cashFlowEffect === "inflow" ? "Aumenta o caixa" :
    item.cashFlowEffect === "outflow" ? "Reduz o caixa" :
      item.origin === "credit_card" ? "Será reconhecido no pagamento da fatura" : "Neutro";
  const consumptionLabel = item.consumptionEffect === "expense" ? "Despesa de consumo" :
    item.consumptionEffect === "income" ? "Reduz o consumo" : "Não altera o consumo";
  const originLabel = item.origin === "credit_card" ? "Cartão de crédito" :
    item.origin === "bank_account" ? "Conta bancária" :
      item.origin === "transfer" ? "Transferência" :
        item.origin === "manual_adjustment" ? "Ajuste manual" : "PDF de fatura";
  const originalMoney = item.isForeignTransaction &&
    item.originalAmount !== null &&
    item.originalCurrencyCode
    ? formatMoneyByCurrency(item.originalAmount, item.originalCurrencyCode)
    : null;
  const convertedMoney = item.amountBrl === null
    ? null
    : formatMoneyByCurrency(item.amountBrl, "BRL");
  const signedValue = item.consumptionEffect === "expense" || item.cashFlowEffect === "outflow"
    ? -(item.amountBrl ?? 0) : item.amountBrl ?? 0;
  const implicitRate = implicitExchangeRate({
    amountBrl: item.amountBrl,
    originalAmount: item.originalAmount,
    isForeignTransaction: item.isForeignTransaction,
  });
  const conversionSourceLabel = item.conversionSource === "pdf"
    ? "Santander PDF"
    : item.conversionSource === "pluggy"
      ? "Pluggy"
      : item.conversionSource === "manual"
        ? "Manual"
        : item.conversionSource === "derived"
          ? "Derivada da descrição"
          : "Não informada";
  return createPortal(
    <div className="movement-drawer-backdrop" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside ref={drawerRef} className="movement-drawer" role="dialog" aria-modal="true" aria-labelledby="movement-drawer-title">
        <header>
          <div><small>{item.displayType}</small><h2 id="movement-drawer-title">{item.description}</h2></div>
          <button type="button" onClick={onClose} aria-label="Fechar detalhes">×</button>
        </header>
        <strong className={`movement-drawer-amount movement-${item.direction}`}>
          {originalMoney ? (
            <span className="movement-drawer-foreign-amount">
              <span>{originalMoney}</span>
              <small>
                {convertedMoney
                  ? `${convertedMoney} em reais`
                  : "Conversão em reais indisponível"}
              </small>
            </span>
          ) : item.amountBrl === null
            ? "Valor convertido indisponível"
            : <Money value={signedValue} signed />}
        </strong>
        <dl>
          <div className="movement-drawer-section-title">
            <dt>Detalhes da movimentação</dt>
            <dd>Datas, origem e classificação financeira</dd>
          </div>
          {item.origin === "credit_card" && cycle ? (
            <>
              <div><dt>Fatura</dt><dd>{cycle.label} · {cycleStatusLabel(cycle)}</dd></div>
              <div><dt>Ciclo</dt><dd>{formatShortDate(cycle.cycleStartDate)} a {formatShortDate(cycle.cycleEndDate)}</dd></div>
            </>
          ) : null}
          <div>
            <dt>{item.isForeignTransaction ? "Data da compra" : "Data"}</dt>
            <dd>{formatShortDate(item.date)}</dd>
          </div>
          {item.postingDate ? (
            <div><dt>Data de lançamento</dt><dd>{formatShortDate(item.postingDate)}</dd></div>
          ) : null}
          {item.isForeignTransaction &&
          item.originalAmount !== null &&
          item.originalCurrencyCode ? (
            <>
              <div className="movement-drawer-section-title">
                <dt>Compra internacional</dt>
                <dd>Valores preservados separadamente</dd>
              </div>
              <div>
                <dt>Valor original</dt>
                <dd>{formatMoneyByCurrency(
                  item.originalAmount,
                  item.originalCurrencyCode,
                )}</dd>
              </div>
              <div>
                <dt>Valor convertido</dt>
                <dd>{item.amountBrl === null
                  ? "Valor convertido indisponÃ­vel"
                  : formatMoneyByCurrency(item.amountBrl, "BRL")}</dd>
              </div>
              {item.exchangeRate ? (
                <div>
                  <dt>Cotação informada</dt>
                  <dd>R$ {item.exchangeRate.toLocaleString("pt-BR", {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 8,
                  })} por {item.originalCurrencyCode} 1</dd>
                </div>
              ) : implicitRate ? (
                <div>
                  <dt>Cotação implícita</dt>
                  <dd>R$ {implicitRate.toLocaleString("pt-BR", {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 4,
                  })} por {item.originalCurrencyCode} 1</dd>
                </div>
              ) : null}
              {item.foreignIofAmount !== null ? (
                <div>
                  <dt>IOF</dt>
                  <dd>{formatMoneyByCurrency(
                    item.foreignIofAmount,
                    "BRL",
                  )}</dd>
                </div>
              ) : null}
              <div><dt>Moeda</dt><dd>{item.originalCurrencyCode}</dd></div>
              <div><dt>Fonte da conversão</dt><dd>{conversionSourceLabel}</dd></div>
            </>
          ) : null}
          <div><dt>{item.origin === "credit_card" ? "Cartão" : "Conta"}</dt><dd>{item.cardLabel || item.accountName}</dd></div>
          <div><dt>Categoria</dt><dd>{item.categoryName}</dd></div>
          <div><dt>Origem</dt><dd>{originLabel}{item.provider ? ` · ${item.provider}` : ""}</dd></div>
          <div><dt>Status</dt><dd>{movementStatusLabel(item.status)}</dd></div>
          {item.installmentNumber && item.installmentTotal ? (
            <div><dt>Parcela</dt><dd>{item.installmentNumber}/{item.installmentTotal}</dd></div>
          ) : null}
          <div><dt>Papel financeiro</dt><dd>{financialRoleLabel(
            item.financialRole || item.transactionRole,
          )}</dd></div>
          <div><dt>Efeito no caixa</dt><dd>{cashLabel}</dd></div>
          <div><dt>Efeito no consumo</dt><dd>{consumptionLabel}</dd></div>
          <div className="movement-drawer-section-title">
            <dt>Referências e conciliação</dt>
            <dd>Identificadores protegidos e vínculos do lançamento</dd>
          </div>
          <div><dt>Descrição original</dt><dd>{item.originalDescription}</dd></div>
          <div><dt>Identificador externo</dt><dd>{item.externalIdMasked || "Não informado"}</dd></div>
          <div><dt>Fatura vinculada</dt><dd>{item.invoiceLinked ? "Sim" : "Não"}</dd></div>
          {item.origin === "credit_card" ? (
            <>
              <div>
                <dt>Conciliação</dt>
                <dd>{item.reconciliationStatus === "matched"
                  ? "PDF e Pluggy conciliados"
                  : item.reconciliationStatus === "pdf_only"
                    ? "Somente PDF"
                    : item.reconciliationStatus === "pluggy_only"
                      ? "Somente Pluggy"
                      : item.reconciliationStatus === "projected_only"
                        ? "Projeção de parcelamento"
                        : item.reconciliationStatus === "manual"
                          ? "Ajuste manual"
                          : "Sem conciliação externa"}</dd>
              </div>
              {item.reconciledSourceIds.length ? (
                <div><dt>Fontes vinculadas</dt><dd>{item.reconciledSourceIds.length + 1}</dd></div>
              ) : null}
            </>
          ) : null}
          <div><dt>Transferência vinculada</dt><dd>{item.transferLinked ? "Sim" : "Não"}</dd></div>
          <div><dt>Última alteração</dt><dd>{item.updatedAt ? formatShortDate(item.updatedAt.slice(0, 10)) : "Não informada"}</dd></div>
        </dl>
        {workspaceId && (
          (item.sourceKind === "transaction" && item.direction === "outflow" &&
            item.consumptionEffect === "expense" && !item.isInvoicePayment) ||
          (item.sourceKind === "card_purchase" && item.transactionRole === "consumption")
        ) ? (
          <section className="movement-establishment">
            <header><div><small>DESPESA EVENTUAL</small><h3>Estabelecimento</h3></div></header>
            {establishmentContext ? (
              <>
                <div className="movement-establishment-linked">
                  <div><span>Associado a</span><strong>{establishmentContext.name}</strong></div>
                  <div><span>Categoria</span><strong>{establishmentContext.categoryName}</strong></div>
                  <div><span>Neste mês</span><Money value={establishmentContext.currentMonthTotal} /></div>
                  <div><span>Mediana mensal</span><Money value={establishmentContext.medianMonthly} /></div>
                  <div><span>Média por pagamento</span><Money value={establishmentContext.averagePayment} /></div>
                  <div><span>Últimos 12 meses</span><Money value={establishmentContext.last12MonthsTotal} /></div>
                </div>
                <p>
                  {establishmentContext.paymentCount} pagamento(s) em {establishmentContext.observedMonths} mês(es) observado(s)
                  .
                </p>
                <form action={async formData => {
                  setEstablishmentFeedback(null);
                  startEstablishmentTransition(async () => {
                    const result = await unlinkExpenseEstablishmentAction(formData);
                    setEstablishmentFeedback({
                      kind: result.ok ? "success" : "error",
                      message: result.message,
                    });
                  });
                }}>
                  <input type="hidden" name="workspace_id" value={workspaceId} />
                  <input type="hidden" name="source_kind" value={item.id.startsWith("invoice-entry:") ? "invoice_entry" : item.sourceKind} />
                  <input type="hidden" name="source_id" value={item.id.replace("invoice-entry:", "")} />
                  <button type="submit" className="movement-establishment-unlink" disabled={isEstablishmentPending}>
                    Remover desta movimentação
                  </button>
                </form>
              </>
            ) : (
              <details>
                <summary>Associar estabelecimento</summary>
                <form action={async formData => {
                  setEstablishmentFeedback(null);
                  startEstablishmentTransition(async () => {
                    const result = await createExpenseEstablishmentAction(formData);
                    setEstablishmentFeedback({
                      kind: result.ok ? "success" : "error",
                      message: result.message,
                    });
                  });
                }}>
                  <input type="hidden" name="workspace_id" value={workspaceId} />
                  <input type="hidden" name="source_kind" value={item.id.startsWith("invoice-entry:") ? "invoice_entry" : item.sourceKind} />
                  <input type="hidden" name="source_id" value={item.id.replace("invoice-entry:", "")} />
                  <label><span>Nome</span><input name="name" defaultValue={item.description} required maxLength={160} /></label>
                  <label><span>Categoria</span><select name="category_id" defaultValue={item.categoryId ?? ""}>
                    <option value="">Sem categoria</option>
                    {categories.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select></label>
                  {item.sourceKind === "transaction" ? <label className="movement-check"><input type="checkbox" name="apply_to_history" defaultChecked /><span>Associar pagamentos anteriores do mesmo destinatário</span></label> : null}
                  <label className="movement-check"><input type="checkbox" name="planning_enabled" /><span>Usar o histórico no planejamento</span></label>
                  <p>{item.sourceKind === "transaction" ? "As próximas saídas do mesmo destinatário serão associadas automaticamente." : "Esta compra será associada somente ao movimento selecionado."} Meses sem pagamento entram como zero na mediana.</p>
                  <button type="submit" disabled={isEstablishmentPending}>
                    {isEstablishmentPending ? "Associando..." : "Criar e associar"}
                  </button>
                </form>
              </details>
            )}
            {establishmentFeedback ? (
              <p className={`movement-form-feedback movement-form-feedback-${establishmentFeedback.kind}`} role={establishmentFeedback.kind === "error" ? "alert" : "status"}>
                {establishmentFeedback.message}
              </p>
            ) : null}
          </section>
        ) : null}
        {workspaceId ? (
          <section className="movement-commitments">
            <header>
              <h3 aria-label="Pessoas e compromissos">
                Pessoa vinculada
              </h3>
              <Link href={`/financeiro/compromissos?workspace=${workspaceId}`}>
                Gerenciar pessoas
              </Link>
            </header>
            {item.sourceKind === "transaction" &&
            commitmentMatches.some(match => match.transactionId === item.id) ? (
              <div className="movement-match-suggestions">
                <b>Sugestões de reconhecimento</b>
                {commitmentMatches.filter(match =>
                  match.transactionId === item.id
                ).slice(0, 3).map(match => <article key={match.occurrenceId}>
                  <span><strong>{match.title}</strong><small>
                    {Math.round(match.score * 100)}% · {match.reasons.join(", ")}
                  </small></span>
                  <form action={confirmCommitmentMatch}>
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="transaction_id" value={item.id} />
                    <input type="hidden" name="occurrence_id" value={match.occurrenceId} />
                    <input type="hidden" name="commitment_id" value={match.commitmentId} />
                    <button>Confirmar</button>
                  </form>
                  <form action={rejectCommitmentMatch}>
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="transaction_id" value={item.id} />
                    <input type="hidden" name="commitment_id" value={match.commitmentId} />
                    <button>Rejeitar</button>
                  </form>
                </article>)}
              </div>
            ) : null}
            {item.sourceKind === "transaction" ? (
              <>
                {personContext ? (
                  <div className="movement-person-context" role="status">
                    <div>
                      <span>Pessoa vinculada</span>
                      <strong>{personContext.personName}</strong>
                    </div>
                    <div>
                      <span>Movimento na conta</span>
                      <strong>{item.direction === "inflow"
                        ? "O dinheiro entrou na conta"
                        : item.direction === "outflow"
                          ? "O dinheiro saiu da conta"
                          : "Não alterou o saldo da conta"}</strong>
                    </div>
                    <form action={async formData => {
                      setCounterpartyFeedback(null);
                      startCounterpartyTransition(async () => {
                        const result =
                          await unlinkMovementSourceFromPersonAction(formData);
                        setCounterpartyFeedback({
                          kind: result.ok ? "success" : "error",
                          message: result.message,
                        });
                      });
                    }}>
                      <input type="hidden" name="workspace_id" value={workspaceId} />
                      <input type="hidden" name="movement_id" value={item.id} />
                      <input
                        type="hidden"
                        name="person_id"
                        value={personContext.personId}
                      />
                      <button
                        type="submit"
                        className="movement-entity-unlink"
                        disabled={isCounterpartyPending}
                      >
                        Desvincular pessoa
                      </button>
                    </form>
                  </div>
                ) : null}
                <form action={async formData => {
                  setCounterpartyFeedback(null);
                  startCounterpartyTransition(async () => {
                    const result = await linkMovementSourceToPersonAction(formData);
                    setCounterpartyFeedback({
                      kind: result.ok ? "success" : "error",
                      message: result.message,
                    });
                  });
                }} className="movement-person-simple-form">
                  <input type="hidden" name="workspace_id" value={workspaceId} />
                  <input type="hidden" name="movement_id" value={item.id} />
                  <label><span>Pessoa</span>
                    <select
                      name="person_id"
                      required
                      defaultValue={personContext?.personId ?? ""}
                    >
                      <option value="" disabled>Selecione uma pessoa</option>
                      {people.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  </label>
                  <p className="movement-person-explanation">
                    A pessoa será associada somente a esta movimentação.
                    Nenhuma regra ou vínculo automático será criado.
                  </p>
                  <button type="submit" disabled={!people.length || isCounterpartyPending}>
                    {isCounterpartyPending ? "Associando..." : "Associar pessoa"}
                  </button>
                  {counterpartyFeedback ? (
                    <p
                      className={`movement-form-feedback movement-form-feedback-${counterpartyFeedback.kind}`}
                      role={counterpartyFeedback.kind === "error" ? "alert" : "status"}
                    >
                      {counterpartyFeedback.message}
                    </p>
                  ) : null}
                </form>
                <details className="movement-secondary-action">
                  <summary>Vincular a um compromisso ou parcela</summary>
                  <form action={async formData => {
                    setCommitmentFeedback(null);
                    startCommitmentTransition(async () => {
                      const result =
                        await linkTransactionToOccurrence(formData);
                      setCommitmentFeedback({
                        kind: result.ok ? "success" : "error",
                        message: result.message,
                      });
                      setCommitmentReplacementRequired(
                        Boolean(result.fieldErrors.replace_existing),
                      );
                    });
                  }}>
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="transaction_id" value={item.id} />
                    <label>
                      <span>Compromisso</span>
                      <select name="occurrence_id" required defaultValue="">
                        <option value="" disabled>Selecione uma ocorrência</option>
                        {commitmentOccurrences.map(option =>
                          <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                    {commitmentReplacementRequired ? (
                      <label className="movement-link-replace-confirm">
                        <input
                          type="checkbox"
                          name="replace_existing"
                          value="true"
                          required
                        />
                        <span>
                          <b>Transferir este pagamento</b>
                          <small>
                            O compromisso anterior voltará a ficar pendente ou
                            atrasado, conforme a data.
                          </small>
                        </span>
                      </label>
                    ) : null}
                    <p className="movement-person-explanation">
                      Ao confirmar, o Atlas memoriza o identificador seguro do
                      destino. Próximos pagamentos para o mesmo destino serão
                      associados ao compromisso do mês e somados até quitar o
                      valor previsto.
                    </p>
                    <button
                      type="submit"
                      disabled={!commitmentOccurrences.length ||
                        isCommitmentPending}
                    >
                      {isCommitmentPending
                        ? "Vinculando..."
                        : commitmentReplacementRequired
                          ? "Confirmar transferência"
                          : "Vincular pagamento"}
                    </button>
                    {commitmentFeedback ? (
                      <p
                        className={`movement-form-feedback movement-form-feedback-${commitmentFeedback.kind}`}
                        role={commitmentFeedback.kind === "error"
                          ? "alert"
                          : "status"}
                      >
                        {commitmentFeedback.message}
                      </p>
                    ) : null}
                  </form>
                </details>
                <details className="movement-secondary-action">
                  <summary>Prever novamente</summary>
                  <form action={async formData => {
                    setRecurringFeedback(null);
                    startRecurringTransition(async () => {
                      try {
                        const result =
                          await transformTransactionIntoRecurringCommitment(formData);
                        setRecurringFeedback({
                          kind: result.ok ? "success" : "error",
                          message: result.message,
                        });
                      } catch {
                        setRecurringFeedback({
                          kind: "error",
                          message: "Não foi possível criar a recorrência. Tente novamente.",
                        });
                      }
                    });
                  }}>
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="transaction_id" value={item.id} />
                    <label><span>Nome</span><input name="title" defaultValue={item.description} required /></label>
                    <label><span>Isso se repete?</span><select name="recurrence_frequency" defaultValue="monthly">
                      <option value="monthly">Todo mês</option>
                      <option value="weekly">Toda semana</option>
                      <option value="biweekly">A cada 15 dias</option>
                      <option value="annual">Todo ano</option>
                      <option value="custom">Outra frequência</option>
                    </select></label>
                    <label><span>Relacionado a quem?</span><select name="person_id" defaultValue="">
                      <option value="">Pessoal</option>
                      {people.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select></label>
                    <button type="submit" disabled={isRecurringPending}>
                      {isRecurringPending ? "Criando recorrência..." : "Criar e vincular"}
                    </button>
                    {recurringFeedback ? (
                      <p
                        className={`movement-form-feedback movement-form-feedback-${recurringFeedback.kind}`}
                        role={recurringFeedback.kind === "error" ? "alert" : "status"}
                      >
                        {recurringFeedback.message}
                      </p>
                    ) : null}
                  </form>
                </details>
              </>
            ) : (
              <>
                <p>Compras do cartão podem pagar um compromisso. A identificação por pessoa é feita na despesa conciliada.</p>
                <details className="movement-secondary-action">
                  <summary>Vincular a um compromisso ou parcela</summary>
                  <form action={linkCardMovementToOccurrence}>
                    <input type="hidden" name="workspace_id" value={workspaceId} />
                    <input type="hidden" name="movement_id" value={item.id} />
                    <label>
                      <span>Compromisso</span>
                      <select name="occurrence_id" required defaultValue="">
                        <option value="" disabled>Selecione uma ocorrência</option>
                        {commitmentOccurrences.map(option =>
                          <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </label>
                    <button type="submit" disabled={!commitmentOccurrences.length}>
                      Vincular pagamento
                    </button>
                  </form>
                </details>
              </>
            )}
          </section>
        ) : null}
        {item.sourceKind === "transaction" ? (
          <p className="movement-drawer-note">
            Correções de categoria e classificação permanecem disponíveis no fluxo financeiro seguro do Atlas.
          </p>
        ) : null}
        {item.sourceKind === "card_purchase" &&
        item.id.startsWith("card-purchase:") &&
        item.isForeignTransaction ? (
          <form
            action={correctForeignCardMovementAmounts}
            className="foreign-movement-correction"
          >
            <h3>Corrigir valores da compra internacional</h3>
            <input type="hidden" name="movement_id" value={item.id} />
            <input
              type="hidden"
              name="cycle_id"
              value={cycle?.cycleId ?? item.cycleId ?? ""}
            />
            <label>
              <span>Moeda original</span>
              <input
                name="original_currency_code"
                defaultValue={item.originalCurrencyCode ?? ""}
                maxLength={3}
                required
              />
            </label>
            <label>
              <span>Valor original</span>
              <input
                name="original_amount"
                inputMode="decimal"
                defaultValue={item.originalAmount?.toFixed(2).replace(".", ",")}
                required
              />
            </label>
            <label>
              <span>Valor convertido em reais</span>
              <input
                name="amount_brl"
                inputMode="decimal"
                defaultValue={item.amountBrl?.toFixed(2).replace(".", ",")}
                required
              />
            </label>
            <label>
              <span>IOF</span>
              <input
                name="foreign_iof_amount"
                inputMode="decimal"
                defaultValue={item.foreignIofAmount?.toFixed(2).replace(".", ",")}
              />
            </label>
            <label>
              <span>CotaÃ§Ã£o informada (opcional)</span>
              <input
                name="exchange_rate"
                inputMode="decimal"
                defaultValue={item.exchangeRate?.toString().replace(".", ",")}
              />
            </label>
            <label>
              <span>Fonte</span>
              <select name="correction_source" defaultValue="santander_manual">
                <option value="santander_manual">Santander manual</option>
                <option value="manual">CorreÃ§Ã£o manual</option>
              </select>
            </label>
            <label className="foreign-movement-note">
              <span>ObservaÃ§Ã£o</span>
              <textarea name="note" maxLength={500} />
            </label>
            <button type="submit">Salvar correÃ§Ã£o</button>
          </form>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}

export function MovementsBrowser({
  filters,
  items,
  summary,
  displaySummary,
  openCycleBreakdown,
  resolvedOpenInvoice,
  accounts,
  cards,
  cardCycles,
  selectedCycle,
  categories,
  totalCount,
  paginationTotalCount,
  page,
  pageSize,
  hasConnectedAccount,
  completeness,
  warnings,
  workspaceId,
  people,
  commitmentOccurrences,
  commitmentMatches,
  personContexts,
  establishmentContexts,
}: {
  filters: MovementFilters;
  items: MovementListItem[];
  summary: MovementPeriodSummary;
  displaySummary: MovementFilterSummary;
  openCycleBreakdown: OpenCycleBreakdownView | null;
  resolvedOpenInvoice: ResolvedOpenCardInvoice | null;
  accounts: Option[];
  cards: Option[];
  cardCycles: AvailableCardCycle[];
  selectedCycle: AvailableCardCycle | null;
  categories: Option[];
  totalCount: number;
  paginationTotalCount: number;
  page: number;
  pageSize: number;
  hasConnectedAccount: boolean;
  completeness: "complete" | "partial";
  warnings: Array<{ source: string; message: string; code?: string }>;
  workspaceId: string | null;
  people: Option[];
  commitmentOccurrences: Option[];
  commitmentMatches: CommitmentMatchView[];
  personContexts: Record<string, MovementPersonContext>;
  establishmentContexts: Record<string, ExpenseEstablishmentContext>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<MovementListItem | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => groupMovementsByDate(items), [items]);
  const statementNeedsPdf = Boolean(
    filters.type === "card" &&
    selectedCycle &&
    ["closed", "paid"].includes(selectedCycle.kind) &&
    selectedCycle.source !== "pdf",
  );
  const closeDrawer = () => {
    setSelected(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const openDrawer = (item: MovementListItem, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setSelected(item);
  };
  if (!hasConnectedAccount && !accounts.length && !cards.length) {
    return <section className="finance-panel movement-empty-state">
      <h2>Conecte uma conta para ver suas movimentações</h2>
      <p>As movimentações importadas aparecerão aqui automaticamente.</p>
      <Link className="finance-button" href="/financeiro/integracoes">Ir para Integrações</Link>
    </section>;
  }
  return (
    <div className="movements-page">
      <header className="movements-header">
        <div>
          <h1>Movimentações</h1>
          <p>{filters.type === "card"
            ? "Acompanhe a fatura aberta e as compras de cada cartão."
            : filters.type === "all"
              ? "Localize qualquer lançamento sem misturar os totais financeiros."
              : "Acompanhe o que entrou e saiu das suas contas no período selecionado."}</p>
        </div>
      </header>
      <MovementViewTabs
        filters={filters}
        defaultCardCycleId={
          cardCycles.find(cycle => cycle.isCurrent)?.cycleId ??
          cardCycles[0]?.cycleId ??
          null
        }
      />
      {completeness === "partial" ? (
        <aside className="movement-partial-warning" role="status">
          <div>
            <strong>Alguns dados complementares não puderam ser carregados.</strong>
            <p>
              {filters.type === "card"
                ? "A conexão não trouxe todos os dados nesta atualização. Os valores já identificados foram preservados."
                : "As movimentações bancárias continuam disponíveis. O resumo considera somente as fontes carregadas com sucesso."}
            </p>
            <small>
              {warnings.map(warning => warning.message).join(" ")}
            </small>
          </div>
          <div>
            <button type="button" onClick={() => router.refresh()}>
              Tentar novamente
            </button>
            <Link href="/financeiro/cartoes">Ver cartões</Link>
          </div>
        </aside>
      ) : null}
      {filters.type === "card" ? (
        <CurrentCardCyclesOverview
          cycles={cardCycles}
          selectedCycle={selectedCycle}
        />
      ) : null}
      <SummaryCards
        summary={displaySummary}
        cycle={selectedCycle}
        breakdown={openCycleBreakdown}
        resolvedInvoice={resolvedOpenInvoice}
      />
      <MovementFiltersForm
        key={buildMovementQueryKey(filters)}
        filters={filters}
        accounts={accounts}
        cards={cards}
        cardCycles={cardCycles}
        categories={categories}
        people={people}
      />
      {filters.type === "card" && !cardCycles.length ? (
        <section className="finance-panel movement-empty-state movement-cycle-empty">
          <h2>Nenhuma fatura disponível</h2>
          <p>Importe uma fatura em PDF ou aguarde a sincronização dos cartões.</p>
          <div>
            <Link className="finance-button" href="/financeiro/cartoes/importar-fatura">Importar fatura</Link>
            <Link href="/financeiro/cartoes">Ir para Cartões</Link>
          </div>
        </section>
      ) : (
      <section className="movement-results">
        <header>
          <div>
            <h2>{filters.type === "card" && selectedCycle
              ? `Fatura de ${cycleMonthLabel(selectedCycle).toLocaleLowerCase("pt-BR")}`
              : "Histórico"}</h2>
            <p>{filters.type === "card" && selectedCycle
              ? [
                selectedCycle.dueDate
                  ? `Vence ${formatShortDate(selectedCycle.dueDate)}`
                  : null,
                `${formatShortDate(selectedCycle.cycleStartDate)} a ${formatShortDate(selectedCycle.cycleEndDate)}`,
              ].filter(Boolean).join(" · ")
              : `${totalCount} movimentações no período selecionado`}</p>
          </div>
          {summary.reviewPendingCount ? (
            <Link href={queryHref(filters, { review: "pending", page: null })}>
              {summary.reviewPendingCount} movimentações precisam de revisão
            </Link>
          ) : null}
        </header>
        {!items.length ? (
          <div className="movement-empty-state">
            {statementNeedsPdf && selectedCycle ? (
              <>
                <h3>Envie o PDF para gerar as movimentações desta fatura</h3>
                <p>
                  {selectedCycle.officialTotal === null
                    ? "A Pluggy ainda não enviou o valor oficial de fechamento desta fatura. "
                    : "O valor total oficial da Pluggy continua sendo exibido. "}
                  O detalhamento será gerado somente a partir do PDF fechado
                  que você enviar.
                </p>
                <div>
                  <Link
                    className="finance-button"
                    href={`/financeiro/cartoes/importar-fatura?statement=${selectedCycle.cycleId}`}
                    prefetch={false}
                  >
                    Enviar PDF desta fatura
                  </Link>
                  <Link href="/financeiro/cartoes" prefetch={false}>
                    Ver faturas
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h3>Nenhuma movimentação encontrada</h3>
                <p>{filters.type === "card"
                  ? "Ajuste os filtros ou selecione outra fatura."
                  : "Ajuste os filtros ou selecione outro período."}</p>
                <div><Link href="/financeiro/movimentacoes">Limpar filtros</Link>
                  {filters.type === "card"
                    ? <Link href="/financeiro/cartoes/importar-fatura">Importar fatura</Link>
                    : <Link href="/financeiro/movimentacoes?type=bank&period=this-month">Ver este mês</Link>}</div>
              </>
            )}
          </div>
        ) : filters.type === "card" ? (
          <CardMovementsSections items={items} onOpen={openDrawer} />
        ) : (
          <div className="movement-list-compact">
            {Object.entries(groups).map(([date, group]) => {
              const daily = calculateMovementSummaryByFilter(
                group,
                filters.type as MovementSourceFilter,
              );
              const dailyLabel = filters.type === "card"
                ? "total do dia"
                : filters.type === "transfer"
                  ? "volume do dia"
                  : filters.type === "adjustment"
                    ? "líquido do dia"
                    : "fluxo do dia";
              return <section key={date} className="movement-date-group">
                <header><h3>{formatGroupDate(date)}</h3><p>
                  {group.length} {filters.type === "card"
                    ? group.length === 1 ? "compra" : "compras"
                    : group.length === 1 ? "movimentação" : "movimentações"} • {dailyLabel}{" "}
                  <Money
                    value={daily.cards[2].value ?? 0}
                    signed={filters.type !== "card"}
                  />
                </p></header>
                <div>{group.map(item => <MovementRow
                  item={item}
                  personContext={personContexts[item.id]}
                  onOpen={openDrawer}
                  key={`${item.sourceKind}-${item.id}`}
                />)}</div>
              </section>;
            })}
          </div>
        )}
        {paginationTotalCount ? <footer className="movement-pagination">
          <p>{filters.type === "card"
            ? <>Exibindo {Math.min(page * pageSize, paginationTotalCount)} de {paginationTotalCount} compras do per&iacute;odo</>
            : <>Exibindo {Math.min(page * pageSize, paginationTotalCount)} de {paginationTotalCount} movimenta&ccedil;&otilde;es</>}</p>
          <nav aria-label="Paginação de movimentações">
            {page > 1 ? <Link href={queryHref(filters, { page: String(page - 1) })}>Anterior</Link> : null}
            {page * pageSize < paginationTotalCount
              ? <Link href={queryHref(filters, { page: String(page + 1) })}>Próxima</Link>
              : null}
          </nav>
        </footer> : null}
      </section>
      )}
      <MovementDetailsDrawer
        key={selected ? `${selected.sourceKind}:${selected.id}` : "closed"}
        item={selected}
        cycle={selectedCycle}
        workspaceId={workspaceId}
        people={people}
        personContext={selected ? personContexts[selected.id] : undefined}
        establishmentContext={selected ? establishmentContexts[selected.id] : undefined}
        categories={categories}
        commitmentOccurrences={commitmentOccurrences}
        commitmentMatches={commitmentMatches}
        onClose={closeDrawer}
      />
    </div>
  );
}
