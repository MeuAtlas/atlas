"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Money } from "./value-visibility";
import {
  buildMovementFiltersUrl,
  calculateMovementSummaryByFilter,
  groupMovementsByDate,
  navigateIfChanged,
  type MovementFilters,
  type MovementFilterSummary,
  type MovementListItem,
  type MovementPeriodSummary,
  type MovementSourceFilter,
} from "@/modules/finance/movement-filters";
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
  addManualCardCycleMovement,
  correctForeignCardMovementAmounts,
} from "@/modules/finance/actions";

type Option = { id: string; name: string; parentId?: string };
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
  const isConfirmedClosedCycle = Boolean(
    cycle &&
    cycle.officialTotal !== null &&
    ["closed", "paid"].includes(cycle.kind),
  );
  return (
    <div className="movement-summary-shell">
      <section className="movement-summary" aria-label="Resumo do período">
        {(summary.mode === "card" && breakdown
          ? [
            {
              label: "Total confirmado",
              value: breakdown.confirmedOpenTotal ?? null,
              tone: "neutral" as const,
              signed: false,
            },
            {
              label: "Compras novas",
              value: breakdown.newPurchasesTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Parcelas lançadas",
              value: breakdown.postedInstallmentsTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Parcelas projetadas",
              value: breakdown.installmentsDataStatus === "unavailable"
                ? null
                : breakdown.projectedUnpostedInstallmentsTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Detalhado pelo Atlas",
              value: breakdown.detailedTotal ?? null,
              tone: "negative" as const,
              signed: false,
            },
            {
              label: "Diferença a detalhar",
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
          ) : (
            <>
              {breakdown ? (
                <>
                  <span>
                    Encargos/IOF{" "}
                    {breakdown.feesAndTaxesTotal === null ||
                    breakdown.feesAndTaxesTotal === undefined
                      ? "indisponível"
                      : <Money value={breakdown.feesAndTaxesTotal} />}
                  </span>
                  <span>
                    Créditos/estornos{" "}
                    {breakdown.creditsAndRefundsTotal === null ||
                    breakdown.creditsAndRefundsTotal === undefined
                      ? "indisponível"
                      : <Money value={breakdown.creditsAndRefundsTotal} />}
                  </span>
                  <span>
                    Parcelas: {breakdown.installmentsDataStatus === "unavailable"
                      ? "não foi possível carregar"
                      : breakdown.installmentsDataStatus === "confirmed_zero"
                        ? "nenhuma confirmada"
                        : "dados disponíveis"}
                  </span>
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
  if (cycle.kind === "estimated") return "Aberta · Projeção atual";
  if (cycle.status === "open") return "Aberta";
  if (cycle.status === "paid") return "Paga";
  if (cycle.status === "overdue") return "Vencida";
  if (cycle.status === "closed") return "Fechada";
  return "Status desconhecido";
}

function cycleMilestoneLabel(cycle: AvailableCardCycle) {
  if (cycle.status === "open" && cycle.closingDate) {
    return `fecha em ${formatShortDate(cycle.closingDate)}`;
  }
  if (cycle.dueDate) {
    return `vence em ${formatShortDate(cycle.dueDate)}`;
  }
  return null;
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
  return (
    <label className="movement-card-bill">
      <span>Fatura</span>
      <select name="cycle" value={value} onChange={event => onChange(event.target.value)}>
        {cycles.map(cycle => (
          <option value={cycle.cycleId} key={cycle.cycleId}>
            {cycle.compactLabel}
            {cycleMilestoneLabel(cycle) ? ` · ${cycleMilestoneLabel(cycle)}` : ""}
            {` · ${cycleStatusLabel(cycle)}`}
          </option>
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
        <option value="">Todos os cartões</option>
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
}: {
  filters: MovementFilters;
  accounts: Option[];
  cards: Option[];
  cardCycles: AvailableCardCycle[];
  categories: Option[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [period, setPeriod] = useState(filters.period || "this-month");
  const [type, setType] = useState<MovementSourceFilter>(
    (filters.type || "all") as MovementSourceFilter,
  );
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
    filters.origin,
    filters.status,
    filters.review,
    type === "card" ? null : filters.card,
    filters.ignored,
    filters.uncategorized,
    filters.document,
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
        <label className="movement-search">
          <span>Busca</span>
          <input
            name="search"
            defaultValue={filters.search || filters.q || ""}
            placeholder="Buscar movimentação"
          />
        </label>
        <MovementTypeSelect value={type} onChange={nextType => {
          setType(nextType);
          if (nextType === "card") {
            setCycleId(defaultCycle);
            setCardId("");
          } else {
            setCycleId("");
            setCardId("");
            setPeriod(filters.period || "this-month");
          }
        }} />
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
              <span>Conta</span>
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
          <label><span>Origem</span><select name="origin" defaultValue={filters.origin || ""}>
            <option value="">Todas</option><option value="pluggy">Pluggy</option><option value="manual">Manual</option>
          </select></label>
          <label><span>Status</span><select name="status" defaultValue={filters.status || ""}>
            <option value="">Todos</option><option value="realized">Realizado</option>
            <option value="pending">Pendente</option><option value="forecast">Previsto</option>
          </select></label>
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
  onOpen,
}: {
  item: MovementListItem;
  onOpen: (item: MovementListItem, trigger: HTMLButtonElement) => void;
}) {
  const exceptions = exceptionLabels(item);
  const signedValue = item.consumptionEffect === "expense" || item.cashFlowEffect === "outflow"
    ? -(item.amountBrl ?? 0)
    : item.consumptionEffect === "income" || item.cashFlowEffect === "inflow"
      ? item.amountBrl ?? 0
      : 0;
  const originalMoney = item.isForeignTransaction &&
    item.originalAmount !== null &&
    item.originalCurrencyCode
      ? formatMoneyByCurrency(
        item.originalAmount,
        item.originalCurrencyCode,
      )
      : null;
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
      ].filter(Boolean).join(" ")}
    >
      <span className="movement-row-main">
        <b>{item.description}</b>
        <small>
          {item.cardLabel || item.accountName}
          {item.accountMaskedIdentifier ? ` • ${item.accountMaskedIdentifier}` : ""}
          {item.provider === "Pluggy" ? " • Pluggy" : ""}
          {` • ${formatShortDate(item.date)}`}
        </small>
        {exceptions.length ? <span className="movement-exceptions">
          {exceptions.map(label => <i key={label}>{label}</i>)}
        </span> : null}
      </span>
      <span className="movement-row-category">{item.categoryName}</span>
      <span className="movement-row-value">
        {item.amountBrl === null
          ? <b>Valor convertido indisponÃ­vel</b>
          : item.direction === "transfer" || item.direction === "adjustment"
            ? <Money value={item.amountBrl} />
            : <Money value={signedValue} signed />}
        {originalMoney ? (
          <small className="movement-row-original" aria-hidden="true">
            {originalMoney} original
          </small>
        ) : null}
        <small>{item.displayType}</small>
      </span>
    </button>
  );
}

function MovementDetailsDrawer({
  item,
  cycle,
  onClose,
}: {
  item: MovementListItem | null;
  cycle?: AvailableCardCycle | null;
  onClose: () => void;
}) {
  const drawerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!item) return;
    const drawer = drawerRef.current;
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
    return () => document.removeEventListener("keydown", handleKey);
  }, [item, onClose]);
  if (!item) return null;
  const cashLabel = item.cashFlowEffect === "inflow" ? "Aumenta o caixa" :
    item.cashFlowEffect === "outflow" ? "Reduz o caixa" :
      item.origin === "credit_card" ? "Será reconhecido no pagamento da fatura" : "Neutro";
  const consumptionLabel = item.consumptionEffect === "expense" ? "Despesa de consumo" :
    item.consumptionEffect === "income" ? "Reduz o consumo" : "Não altera o consumo";
  const originLabel = item.origin === "credit_card" ? "Cartão de crédito" :
    item.origin === "bank_account" ? "Conta bancária" :
      item.origin === "transfer" ? "Transferência" :
        item.origin === "manual_adjustment" ? "Ajuste manual" : "PDF de fatura";
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
  return (
    <div className="movement-drawer-backdrop" onMouseDown={event => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside ref={drawerRef} className="movement-drawer" role="dialog" aria-modal="true" aria-labelledby="movement-drawer-title">
        <header>
          <div><small>{item.displayType}</small><h2 id="movement-drawer-title">{item.description}</h2></div>
          <button type="button" onClick={onClose} aria-label="Fechar detalhes">×</button>
        </header>
        <strong className={`movement-drawer-amount movement-${item.direction}`}>
          {item.amountBrl === null
            ? "Valor convertido indisponÃ­vel"
            : <Money value={signedValue} signed />}
        </strong>
        <dl>
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
          <div><dt>Status</dt><dd>{item.status}</dd></div>
          {item.installmentNumber && item.installmentTotal ? (
            <div><dt>Parcela</dt><dd>{item.installmentNumber}/{item.installmentTotal}</dd></div>
          ) : null}
          <div><dt>Papel financeiro</dt><dd>{item.financialRole || item.transactionRole}</dd></div>
          <div><dt>Efeito no caixa</dt><dd>{cashLabel}</dd></div>
          <div><dt>Efeito no consumo</dt><dd>{consumptionLabel}</dd></div>
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
    </div>
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
  page,
  pageSize,
  hasConnectedAccount,
  completeness,
  warnings,
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
  page: number;
  pageSize: number;
  hasConnectedAccount: boolean;
  completeness: "complete" | "partial";
  warnings: Array<{ source: string; message: string; code?: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<MovementListItem | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualType, setManualType] = useState("new_purchase");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => groupMovementsByDate(items), [items]);
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
            ? "Consulte as compras e os créditos da fatura selecionada."
            : "Consulte entradas, saídas e transferências das suas contas."}</p>
        </div>
        {filters.type === "card" && selectedCycle ? (
          <button
            type="button"
            className="finance-button"
            onClick={() => setManualOpen(true)}
          >
            Adicionar lançamento
          </button>
        ) : null}
      </header>
      {manualOpen && selectedCycle ? (
        <div
          className="movement-manual-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setManualOpen(false);
          }}
        >
          <section
            className="movement-manual-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="movement-manual-title"
          >
            <header>
              <div>
                <h2 id="movement-manual-title">Adicionar lançamento</h2>
                <p>O valor informado deve ser o valor em reais que compõe a fatura.</p>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                onClick={() => setManualOpen(false)}
              >
                ×
              </button>
            </header>
            <form action={addManualCardCycleMovement}>
              <input type="hidden" name="cycle_id" value={selectedCycle.cycleId} />
              <input type="hidden" name="card_id" value={selectedCycle.cardAccountId} />
              <label>
                <span>Descrição</span>
                <input name="description" maxLength={160} required />
              </label>
              <label>
                <span>Tipo</span>
                <select
                  name="movement_type"
                  value={manualType}
                  onChange={event => setManualType(event.target.value)}
                >
                  <option value="new_purchase">Compra nova</option>
                  <option value="posted_installment">Parcela lançada</option>
                  <option value="credit">Crédito</option>
                  <option value="refund">Estorno</option>
                  <option value="fee">Taxa</option>
                  <option value="tax">IOF ou imposto</option>
                  <option value="adjustment">Ajuste</option>
                </select>
              </label>
              <label>
                <span>Data original</span>
                <input
                  name="original_date"
                  type="date"
                  defaultValue={selectedCycle.cycleEndDate}
                  required
                />
              </label>
              <label>
                <span>Data de lançamento</span>
                <input
                  name="posting_date"
                  type="date"
                  defaultValue={selectedCycle.cycleEndDate}
                  required
                />
              </label>
              <label>
                <span>Competência</span>
                <input
                  name="competence_month"
                  type="date"
                  defaultValue={
                    `${(selectedCycle.dueDate ?? selectedCycle.cycleEndDate).slice(0, 7)}-01`
                  }
                  required
                />
              </label>
              <label>
                <span>Valor em BRL</span>
                <input name="amount" inputMode="decimal" placeholder="0,00" required />
              </label>
              <label>
                <span>Cartão</span>
                <select name="instrument_id" defaultValue="">
                  <option value="">Não identificado</option>
                  {cards.map(card => (
                    <option value={card.id} key={card.id}>{card.name}</option>
                  ))}
                </select>
              </label>
              {manualType === "posted_installment" ? (
                <>
                  <label>
                    <span>Parcela atual</span>
                    <input name="installment_number" type="number" min="1" required />
                  </label>
                  <label>
                    <span>Total de parcelas</span>
                    <input name="installment_total" type="number" min="2" max="120" required />
                  </label>
                </>
              ) : null}
              <label>
                <span>Moeda original</span>
                <input
                  name="currency"
                  defaultValue="BRL"
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  title="Código ISO com três letras, como BRL, USD ou EUR"
                  required
                />
              </label>
              <label>
                <span>Valor original (opcional)</span>
                <input name="original_amount" inputMode="decimal" />
              </label>
              <label>
                <span>Cotação (opcional)</span>
                <input name="exchange_rate" inputMode="decimal" />
              </label>
              <label>
                <span>IOF em BRL (opcional)</span>
                <input name="foreign_iof_amount" inputMode="decimal" />
              </label>
              <label className="movement-manual-note">
                <span>Observação</span>
                <textarea name="note" maxLength={500} rows={3} />
              </label>
              <footer>
                <button type="button" onClick={() => setManualOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="finance-button">
                  Salvar lançamento
                </button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
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
      <SummaryCards
        summary={displaySummary}
        cycle={selectedCycle}
        breakdown={openCycleBreakdown}
        resolvedInvoice={resolvedOpenInvoice}
      />
      <MovementFiltersForm
        filters={filters}
        accounts={accounts}
        cards={cards}
        cardCycles={cardCycles}
        categories={categories}
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
              ? selectedCycle.isCurrent
                ? "Fatura atual"
                : `Fatura de ${selectedCycle.label.toLocaleLowerCase("pt-BR")}`
              : "Histórico"}</h2>
            <p>{filters.type === "card" && selectedCycle
              ? `${formatShortDate(selectedCycle.cycleStartDate)} a ${formatShortDate(selectedCycle.cycleEndDate)}`
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
            <h3>Nenhuma movimentação encontrada</h3>
            <p>{filters.type === "card"
              ? "Ajuste os filtros ou selecione outra fatura."
              : "Ajuste os filtros ou selecione outro período."}</p>
            <div><Link href="/financeiro/movimentacoes">Limpar filtros</Link>
              {filters.type === "card"
                ? <Link href="/financeiro/cartoes/importar-fatura">Importar fatura</Link>
                : <Link href="/financeiro/movimentacoes?type=bank&period=this-month">Ver este mês</Link>}</div>
          </div>
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
                <div>{group.map(item => <MovementRow item={item} onOpen={openDrawer} key={`${item.sourceKind}-${item.id}`} />)}</div>
              </section>;
            })}
          </div>
        )}
        {totalCount ? <footer className="movement-pagination">
          <p>Exibindo {Math.min(page * pageSize, totalCount)} de {totalCount} movimentações</p>
          <nav aria-label="Paginação de movimentações">
            {page > 1 ? <Link href={queryHref(filters, { page: String(page - 1) })}>Anterior</Link> : null}
            {page * pageSize < totalCount
              ? <Link href={queryHref(filters, { page: String(page + 1) })}>Próxima</Link>
              : null}
          </nav>
        </footer> : null}
      </section>
      )}
      <MovementDetailsDrawer item={selected} cycle={selectedCycle} onClose={closeDrawer} />
    </div>
  );
}
