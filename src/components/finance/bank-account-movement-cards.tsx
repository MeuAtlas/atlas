"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BankAccountMonthlyMovement,
  BankAccountMovementItem,
} from "@/modules/finance/account-movement";
import { formatDate } from "@/modules/finance/format";
import { Money } from "./value-visibility";

export type BankMovementDetailsType = "inflow" | "outflow";

export type BankAccountMovementCardsProps = {
  movement: BankAccountMonthlyMovement;
  initialDetails?: BankMovementDetailsType | null;
};

function formatMonth(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatSync(value: string | null) {
  if (!value) return "Não informada";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function comparison(current: number, previous: number) {
  if (!previous) return "Sem base válida no mês anterior";
  const percentage = ((current - previous) / previous) * 100;
  const signal = percentage > 0 ? "+" : "";
  return `${signal}${percentage.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })}% vs. mês anterior`;
}

function itemMatches(item: BankAccountMovementItem, search: string) {
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return true;
  return [
    item.description,
    item.nature,
    item.category,
    item.origin,
    item.status,
  ].some((value) => value.toLocaleLowerCase("pt-BR").includes(normalized));
}

function sortedItems(items: BankAccountMovementItem[], sort: string) {
  return [...items].sort((left, right) => {
    if (sort === "oldest") return left.date.localeCompare(right.date);
    if (sort === "largest") return right.amount - left.amount;
    if (sort === "smallest") return left.amount - right.amount;
    return right.date.localeCompare(left.date);
  });
}

function trapFocus(
  event: KeyboardEvent,
  container: HTMLElement,
  close: () => void,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])',
    ),
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function MovementItem({ item }: { item: BankAccountMovementItem }) {
  return (
    <details className="finance-metric-item">
      <summary>
        <span className="finance-metric-item-date">
          <b>{item.date.slice(8, 10)}</b>
          <small>
            {new Intl.DateTimeFormat("pt-BR", {
              month: "short",
              timeZone: "UTC",
            })
              .format(new Date(`${item.date}T12:00:00Z`))
              .replace(".", "")}
          </small>
        </span>
        <span className="finance-metric-item-main">
          <b>{item.description}</b>
          <small>
            {item.nature} · {item.category}
          </small>
          <span className="finance-metric-item-badges">
            <i>{item.origin}</i>
            <i>{item.status}</i>
            {item.reviewStatus === "pending" ? (
              <i className="warning">Revisão pendente</i>
            ) : null}
          </span>
        </span>
        <strong className={item.direction === "inflow" ? "positive" : "negative"}>
          <Money value={item.amount} />
        </strong>
        <i className="finance-metric-chevron" aria-hidden="true">
          ›
        </i>
      </summary>
      <div className="finance-metric-item-details">
        <dl>
          <div>
            <dt>Data</dt>
            <dd>{formatDate(item.date)}</dd>
          </div>
          <div>
            <dt>Natureza</dt>
            <dd>{item.nature}</dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>{item.category}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{item.origin}</dd>
          </div>
          <div>
            <dt>Status bancário</dt>
            <dd>{item.status}</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{item.reviewStatus}</dd>
          </div>
          {item.financialRole ? (
            <div>
              <dt>Papel financeiro</dt>
              <dd>{item.financialRole}</dd>
            </div>
          ) : null}
          {item.classificationSource ? (
            <div>
              <dt>Classificação</dt>
              <dd>{item.classificationSource}</dd>
            </div>
          ) : null}
        </dl>
        <Link href="/financeiro/movimentacoes?tab=bank">
          Ver na página completa
        </Link>
      </div>
    </details>
  );
}

function BankMovementDetails({
  movement,
  type,
  onClose,
  drawerRef,
}: {
  movement: BankAccountMonthlyMovement;
  type: BankMovementDetailsType;
  onClose: () => void;
  drawerRef: React.RefObject<HTMLElement | null>;
}) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("recent");
  const [limit, setLimit] = useState(20);
  const inflow = type === "inflow";
  const title = inflow ? "Entradas da conta" : "Saídas da conta";
  const total = inflow ? movement.totalInflow : movement.totalOutflow;
  const items = inflow ? movement.inflowItems : movement.outflowItems;
  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))].sort(),
    [items],
  );
  const filtered = useMemo(
    () =>
      sortedItems(
        items.filter(
          (item) =>
            itemMatches(item, search) &&
            (source === "all" || item.source === source) &&
            (category === "all" || item.category === category),
        ),
        sort,
      ),
    [category, items, search, sort, source],
  );
  const visible = filtered.slice(0, limit);
  const largest = items.reduce(
    (value, item) => Math.max(value, item.amount),
    0,
  );

  return (
    <section
      ref={drawerRef}
      className={`finance-metric-drawer ${type}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="finance-metric-dialog-title"
    >
      <header className="finance-metric-drawer-header">
        <div>
          <p className="eyebrow">{formatMonth(movement.monthStart)}</p>
          <h2 id="finance-metric-dialog-title">{title}</h2>
          <p>
            {inflow ? "Créditos" : "Débitos"} lançados na conta{" "}
            {movement.accountName} em {formatMonth(movement.monthStart)}.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label={`Fechar ${title}`}>
          ×
        </button>
        <strong className={`finance-metric-total ${type}`}>
          <Money value={total} />
        </strong>
        <small>
          {items.length} {items.length === 1 ? "lançamento" : "lançamentos"}
        </small>
      </header>

      <div className="finance-metric-drawer-body">
        {movement.warnings.map((warning) => (
          <p className="overview-section-warning" role="status" key={warning}>
            {warning}
          </p>
        ))}
        <div className="finance-metric-summary" aria-label={`Resumo de ${title}`}>
          <div className={inflow ? "positive" : "negative"}>
            <span>Maior lançamento</span>
            <b>
              <Money value={largest} />
            </b>
          </div>
          <div>
            <span>Período</span>
            <b>
              {formatDate(movement.monthStart)} a{" "}
              {formatDate(
                new Date(
                  new Date(`${movement.monthEnd}T12:00:00Z`).valueOf() -
                    86_400_000,
                )
                  .toISOString()
                  .slice(0, 10),
              )}
            </b>
          </div>
          <div>
            <span>Última sincronização</span>
            <b>{formatSync(movement.lastSyncAt)}</b>
          </div>
          <div className={movement.dataCompleteness === "complete" ? "positive" : "warning"}>
            <span>Status dos dados</span>
            <b>
              {movement.dataCompleteness === "complete"
                ? "Completos"
                : "Dados parciais"}
            </b>
          </div>
        </div>

        <div className="finance-metric-toolbar">
          <label className="finance-metric-search">
            <span className="sr-only">Buscar movimentação</span>
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLimit(20);
              }}
              placeholder="Buscar descrição, natureza ou categoria"
            />
          </label>
          <div className="finance-metric-filters">
            <select
              aria-label="Filtrar por origem"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">Todas as origens</option>
              <option value="pluggy">Pluggy</option>
              <option value="manual">Manual</option>
            </select>
            <select
              aria-label="Filtrar por categoria"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">Todas as categorias</option>
              {categories.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              aria-label="Ordenar lançamentos"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="recent">Mais recentes</option>
              <option value="oldest">Mais antigos</option>
              <option value="largest">Maior valor</option>
              <option value="smallest">Menor valor</option>
            </select>
          </div>
        </div>

        <section className="finance-metric-list" aria-labelledby="finance-metric-list-title">
          <header>
            <h3 id="finance-metric-list-title">Movimentações bancárias</h3>
            <small>{filtered.length} encontradas</small>
          </header>
          {visible.length ? (
            <>
              {visible.map((item) => (
                <MovementItem item={item} key={item.id} />
              ))}
              {visible.length < filtered.length ? (
                <button
                  className="finance-metric-load-more"
                  type="button"
                  onClick={() => setLimit((current) => current + 20)}
                >
                  Carregar mais
                </button>
              ) : null}
            </>
          ) : (
            <div className="finance-metric-message">
              <b>
                {search || source !== "all" || category !== "all"
                  ? "Nenhuma movimentação corresponde aos filtros."
                  : `Nenhuma ${inflow ? "entrada" : "saída"} efetiva no período.`}
              </b>
            </div>
          )}
        </section>
      </div>

      <footer className="finance-metric-drawer-footer">
        <button className="finance-button" type="button" onClick={onClose}>
          Fechar
        </button>
        <Link href="/financeiro/movimentacoes?tab=bank">
          Ver extrato completo
        </Link>
      </footer>
    </section>
  );
}

export function BankAccountMovementCards({
  movement,
  initialDetails,
}: BankAccountMovementCardsProps) {
  const [open, setOpen] = useState<BankMovementDetailsType | null>(
    initialDetails ?? null,
  );
  const drawerRef = useRef<HTMLElement>(null);
  const pushedEntry = useRef(false);
  const activeTrigger = useRef<HTMLButtonElement | null>(null);

  const close = () => {
    if (pushedEntry.current) {
      pushedEntry.current = false;
      window.history.back();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("details");
    window.history.replaceState(null, "", url);
    setOpen(null);
  };

  const show = (
    type: BankMovementDetailsType,
    trigger: HTMLButtonElement,
  ) => {
    activeTrigger.current = trigger;
    const url = new URL(window.location.href);
    url.searchParams.set("details", type);
    window.history.pushState(null, "", url);
    pushedEntry.current = true;
    setOpen(type);
  };

  useEffect(() => {
    const onPopState = () => {
      const value = new URL(window.location.href).searchParams.get("details");
      setOpen(value === "inflow" || value === "outflow" ? value : null);
      pushedEntry.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = activeTrigger.current;
    const drawer = drawerRef.current;
    const frame = window.requestAnimationFrame(() => {
      drawer?.querySelector<HTMLElement>("button")?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (drawer) trapFocus(event, drawer, close);
    };
    document.addEventListener("keydown", keydown);
    document.body.classList.add("finance-metric-open");
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      document.body.classList.remove("finance-metric-open");
      previous?.focus();
    };
  }, [open]);

  const cards = [
    {
      type: "inflow" as const,
      title: "Entradas da conta",
      subtitle: "Créditos efetivamente lançados no mês.",
      total: movement.totalInflow,
      count: movement.inflowCount,
      previous: movement.previousMonthInflow,
      icon: "↓",
      kind: "total" as const,
    },
    {
      type: "outflow" as const,
      title: "Saídas da conta",
      subtitle: "Débitos efetivamente lançados no mês.",
      total: movement.totalOutflow,
      count: movement.outflowCount,
      previous: movement.previousMonthOutflow,
      icon: "↗",
      kind: "total" as const,
    },
    {
      type: "inflow" as const,
      title: "Maior entrada",
      subtitle: "Nenhuma entrada no período.",
      item: [...movement.inflowItems]
        .sort((left, right) => right.amount - left.amount)
        .at(0),
      icon: "↓",
      kind: "largest" as const,
    },
    {
      type: "outflow" as const,
      title: "Maior saída",
      subtitle: "Nenhuma saída no período.",
      item: [...movement.outflowItems]
        .sort((left, right) => right.amount - left.amount)
        .at(0),
      icon: "↗",
      kind: "largest" as const,
    },
  ];

  return (
    <>
      <div className="overview-metrics" aria-label="Movimentação da conta">
        {cards.map((card) => {
          if (card.kind === "total") {
            return (
              <button
                type="button"
                onClick={(event) => show(card.type, event.currentTarget)}
                key={card.title}
                className={`overview-metric ${card.type} ${card.kind}`}
                aria-label={`Ver detalhes de ${card.title}`}
                aria-haspopup="dialog"
              >
                <header>
                  <i aria-hidden="true">{card.icon}</i>
                  <span>{card.title}</span>
                  <span className="overview-metric-open-label">
                    Ver detalhes ›
                  </span>
                </header>
                <strong>
                  <Money value={card.total} />
                </strong>
                <small>
                  {card.count}{" "}
                  {card.count === 1 ? "lançamento" : "lançamentos"}
                </small>
                <p>{card.subtitle}</p>
                <em>{comparison(card.total, card.previous)}</em>
              </button>
            );
          }

          return (
            <article
              key={card.title}
              className={`overview-metric ${card.type} ${card.kind}`}
            >
              <header>
                <i aria-hidden="true">{card.icon}</i>
                <span>{card.title}</span>
              </header>
              <strong>
                <Money value={card.item?.amount ?? 0} />
              </strong>
              {card.item ? (
                <>
                  <small>{formatDate(card.item.date)}</small>
                  <p>{card.item.description}</p>
                </>
              ) : (
                <p>{card.subtitle}</p>
              )}
            </article>
          );
        })}
      </div>
      {open ? (
        <div
          className="finance-metric-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <BankMovementDetails
            movement={movement}
            type={open}
            onClose={close}
            drawerRef={drawerRef}
          />
        </div>
      ) : null}
    </>
  );
}
