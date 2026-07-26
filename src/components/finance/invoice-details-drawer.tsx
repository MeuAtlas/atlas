"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Money } from "./value-visibility";
import { formatDate } from "@/modules/finance/format";
import {
  getEstimatedInvoiceDetails,
  invoiceLineContribution,
  invoiceLineKind,
  purchaseCompetenceDate,
  type CurrentCardInvoice,
  type InvoiceExclusionReason,
} from "@/modules/finance/card-invoices";
import { installmentLabel } from "@/modules/finance/installments";
import type { CardPurchase } from "@/modules/finance/types";

type InvoiceFilter =
  | "all"
  | "purchase"
  | "installment"
  | "refund"
  | "credit"
  | "fee"
  | "pending"
  | "unassigned";

const filters: Array<[InvoiceFilter, string]> = [
  ["all", "Todos"],
  ["purchase", "Compras"],
  ["installment", "Parcelas"],
  ["refund", "Estornos"],
  ["credit", "Créditos"],
  ["fee", "Tarifas"],
  ["pending", "Pendentes"],
  ["unassigned", "Sem cartão"],
];

const sourceLabels: Record<CurrentCardInvoice["totalSource"], string> = {
  provider_bill: "Fatura oficial da Pluggy",
  manual_bank_confirmation: "Valor informado pelo usuário",
  calculated_transactions: "Calculada pelas movimentações",
};

const statusLabels: Record<CurrentCardInvoice["status"], string> = {
  open: "Fatura aberta",
  closed: "Fatura fechada",
  due: "Vence hoje",
  partially_paid: "Parcialmente paga",
  paid: "Fatura paga",
  overdue: "Fatura vencida",
  estimated: "Fatura estimada",
};

const exclusionLabels: Record<InvoiceExclusionReason, string> = {
  outside_cycle: "Fora do ciclo",
  cancelled: "Cancelado",
  duplicate: "Duplicado conciliado",
  invoice_payment: "Pagamento de fatura",
  invalid_date: "Data inválida",
  awaiting_review: "Aguardando revisão",
  unsupported: "Tipo não considerado",
};

function maskedExternalId(value: string | null | undefined) {
  if (!value) return "Não informado";
  if (value.length <= 9) return `${value.slice(0, 2)}•••${value.slice(-2)}`;
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
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

function instrumentLabel(
  invoice: CurrentCardInvoice,
  purchase: CardPurchase,
) {
  const instrument = invoice.card.credit_card_instruments?.find(
    (item) => item.id === purchase.instrument_id,
  );
  if (!instrument) return "Sem cartão identificado";
  const kind =
    instrument.card_kind === "physical"
      ? "Físico"
      : instrument.card_kind === "virtual"
        ? "Virtual"
        : instrument.card_kind === "online"
          ? "Online"
          : instrument.card_kind === "additional"
            ? "Adicional"
            : invoice.card.brand || "Cartão";
  return `${kind} · ${instrument.last_four_digits || "••••"}`;
}

function matchesSearch(
  invoice: CurrentCardInvoice,
  purchase: CardPurchase,
  search: string,
) {
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  if (!normalized) return true;
  return [
    purchase.description,
    purchase.merchant,
    purchase.provider_category,
    purchase.financial_categories?.name,
    purchase.source,
    instrumentLabel(invoice, purchase),
  ].some((value) => value?.toLocaleLowerCase("pt-BR").includes(normalized));
}

function matchesFilter(purchase: CardPurchase, filter: InvoiceFilter) {
  if (filter === "all") return true;
  if (filter === "pending") return purchase.status === "pending";
  if (filter === "unassigned") return !purchase.instrument_id;
  if (filter === "purchase")
    return purchase.transaction_role === "consumption";
  return invoiceLineKind(purchase) === filter;
}

function PurchaseDetails({
  invoice,
  purchase,
}: {
  invoice: CurrentCardInvoice;
  purchase: CardPurchase;
}) {
  const date = purchaseCompetenceDate(purchase);
  const installment = installmentLabel(purchase, false);
  const contribution = invoiceLineContribution(purchase);
  const kind = invoiceLineKind(purchase);
  const category =
    purchase.financial_categories?.name ||
    purchase.provider_category ||
    "Sem categoria";
  const status =
    purchase.status === "pending"
      ? "PENDING"
      : purchase.status === "realized"
        ? "POSTED"
        : purchase.status.toLocaleUpperCase("pt-BR");

  return (
    <details className={`invoice-details-item ${kind}`}>
      <summary>
        <time dateTime={date}>
          <b>{date.slice(8, 10)}</b>
          <small>
            {new Intl.DateTimeFormat("pt-BR", {
              month: "short",
              timeZone: "UTC",
            })
              .format(new Date(`${date}T12:00:00Z`))
              .replace(".", "")}
          </small>
        </time>
        <span>
          <b>{purchase.description}</b>
          {installment ? <small>{installment}</small> : null}
          <small>
            {instrumentLabel(invoice, purchase)} · {category}
          </small>
          <i className={purchase.status === "pending" ? "pending" : ""}>
            {status}
          </i>
        </span>
        <strong className={contribution < 0 ? "negative" : ""}>
          <Money value={contribution} />
        </strong>
        <i aria-hidden="true">›</i>
      </summary>
      <div className="invoice-details-item-body">
        <dl>
          <div>
            <dt>Descrição</dt>
            <dd>{purchase.description}</dd>
          </div>
          <div>
            <dt>Data da compra</dt>
            <dd>{formatDate(purchase.purchase_date)}</dd>
          </div>
          <div>
            <dt>Data de postagem</dt>
            <dd>{formatDate(purchase.realized_at || null)}</dd>
          </div>
          <div>
            <dt>Competência</dt>
            <dd>{formatDate(purchase.competence_date || date)}</dd>
          </div>
          <div>
            <dt>Valor conciliado</dt>
            <dd>
              <Money value={contribution} />
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{status}</dd>
          </div>
          <div>
            <dt>Instrumento</dt>
            <dd>{instrumentLabel(invoice, purchase)}</dd>
          </div>
          <div>
            <dt>Parcela</dt>
            <dd>
              {installment ||
                (purchase.transaction_role === "consumption"
                  ? "Parcelamento não informado pelo banco"
                  : "Não se aplica")}
            </dd>
          </div>
          <div>
            <dt>Categoria</dt>
            <dd>{category}</dd>
          </div>
          <div>
            <dt>Origem</dt>
            <dd>{purchase.source === "pluggy" ? "Pluggy" : "Manual"}</dd>
          </div>
          <div>
            <dt>Identificador externo</dt>
            <dd>{maskedExternalId(purchase.external_id)}</dd>
          </div>
          <div>
            <dt>Conciliação</dt>
            <dd>Incluído no total calculado</dd>
          </div>
          <div>
            <dt>Revisão</dt>
            <dd>{purchase.review_status}</dd>
          </div>
        </dl>
      </div>
    </details>
  );
}

export function InvoiceDetailsDrawer({
  invoice,
  initialOpen = false,
}: {
  invoice: CurrentCardInvoice;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [instrument, setInstrument] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const [limit, setLimit] = useState(20);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const pushedEntry = useRef(false);
  const details = useMemo(() => getEstimatedInvoiceDetails(invoice), [invoice]);
  const invalidCalculation = !Number.isFinite(details.calculatedTotal);

  const close = useCallback(() => {
    setReady(false);
    if (pushedEntry.current) {
      pushedEntry.current = false;
      window.history.back();
      return;
    }
    setOpen(false);
  }, []);

  const show = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("invoiceDetails", invoice.card.id);
    window.history.pushState(null, "", url);
    pushedEntry.current = true;
    setReady(false);
    setOpen(true);
  };

  useEffect(() => {
    const onPopState = () => {
      const selected = new URL(window.location.href).searchParams.get(
        "invoiceDetails",
      );
      setReady(false);
      setOpen(selected === invoice.card.id);
      pushedEntry.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [invoice.card.id]);

  useEffect(() => {
    if (!open) return;
    const previous = triggerRef.current;
    const frame = window.requestAnimationFrame(() => {
      setReady(true);
      drawerRef.current?.querySelector<HTMLButtonElement>(
        ".invoice-details-close",
      )?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (drawerRef.current) trapFocus(event, drawerRef.current, close);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("invoice-details-open");
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("invoice-details-open");
      previous?.focus();
    };
  }, [close, open]);

  useEffect(() => {
    if (!invalidCalculation) return;
    console.error("[Atlas Invoice Details Error]", {
      cardId: invoice.card.id,
      reason: "invalid_calculation",
    });
  }, [invalidCalculation, invoice.card.id]);

  const filtered = useMemo(
    () =>
      details.includedPurchases
        .filter(
          (purchase) =>
            matchesFilter(purchase, filter) &&
            (instrument === "all"
              ? true
              : instrument === "unassigned"
                ? !purchase.instrument_id
                : purchase.instrument_id === instrument) &&
            matchesSearch(invoice, purchase, search),
        )
        .sort((left, right) => {
          if (sort === "largest")
            return (
              Math.abs(invoiceLineContribution(right)) -
              Math.abs(invoiceLineContribution(left))
            );
          if (sort === "smallest")
            return (
              Math.abs(invoiceLineContribution(left)) -
              Math.abs(invoiceLineContribution(right))
            );
          const comparison = purchaseCompetenceDate(left).localeCompare(
            purchaseCompetenceDate(right),
          );
          return sort === "oldest" ? comparison : -comparison;
        }),
    [details.includedPurchases, filter, instrument, invoice, search, sort],
  );
  const visible = filtered.slice(0, limit);
  const groups = visible.reduce<Map<string, CardPurchase[]>>(
    (result, purchase) => {
      const date = purchaseCompetenceDate(purchase);
      result.set(date, [...(result.get(date) || []), purchase]);
      return result;
    },
    new Map(),
  );
  const unassigned = details.includedPurchases.filter(
    (purchase) => !purchase.instrument_id,
  );
  const unassignedTotal = unassigned.reduce(
    (total, purchase) => total + invoiceLineContribution(purchase),
    0,
  );

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className="invoice-details-trigger"
      onClick={show}
      aria-label={`Ver detalhes da fatura de ${invoice.card.name}`}
      aria-haspopup="dialog"
    >
      Ver detalhes
    </button>
  );

  if (!open || !invoice.cycle) return trigger;

  const drawer = (
    <div className="invoice-details-backdrop" onMouseDown={close}>
      <section
        ref={drawerRef}
        className="invoice-details-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`invoice-details-title-${invoice.card.id}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="invoice-details-header">
          <div>
            <p className="eyebrow">{statusLabels[invoice.status]}</p>
            <h2 id={`invoice-details-title-${invoice.card.id}`}>
              {invoice.card.name}
            </h2>
            <p>
              {invoice.card.brand || invoice.card.institution_name || "Cartão"} ·{" "}
              {invoice.card.last_four_digits || "••••"}
            </p>
          </div>
          <button
            type="button"
            className="invoice-details-close"
            onClick={close}
            aria-label="Fechar detalhes da fatura"
          >
            ×
          </button>
          <dl className="invoice-details-cycle">
            <div>
              <dt>Período</dt>
              <dd>
                {formatDate(invoice.cycle.cycleStart)} a{" "}
                {formatDate(invoice.cycle.cycleEnd)}
              </dd>
            </div>
            <div>
              <dt>Fechamento</dt>
              <dd>{formatDate(invoice.cycle.closingDate)}</dd>
            </div>
            <div>
              <dt>Vencimento</dt>
              <dd>{formatDate(invoice.cycle.dueDate)}</dd>
            </div>
            <div>
              <dt>Fonte</dt>
              <dd>{sourceLabels[invoice.totalSource]}</dd>
            </div>
          </dl>
        </header>

        <div className="invoice-details-body">
          {!ready ? (
            <div
              className="invoice-details-skeleton"
              role="status"
              aria-label="Carregando detalhes da fatura"
            >
              <i />
              <i />
              <i />
              <i />
            </div>
          ) : invalidCalculation ? (
            <div className="invoice-details-error" role="alert">
              <b>Não foi possível carregar os detalhes desta fatura.</b>
              <p>A Visão Geral continua disponível.</p>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setReady(false);
                    window.requestAnimationFrame(() => setReady(true));
                  }}
                >
                  Tentar novamente
                </button>
                <button type="button" onClick={close}>
                  Fechar
                </button>
              </div>
            </div>
          ) : (
            <>
              {details.warnings.map((warning) => (
                <p className="invoice-details-warning" role="status" key={warning}>
                  {warning}
                </p>
              ))}

              <section
                className="invoice-details-summary"
                aria-label="Resumo da fatura"
              >
                <div>
                  <span>Compras</span>
                  <b>
                    <Money value={details.purchaseTotal} />
                  </b>
                </div>
                <div className="negative">
                  <span>Estornos e créditos</span>
                  <b>
                    <Money
                      value={-(details.refundTotal + details.creditTotal)}
                    />
                  </b>
                </div>
                <div>
                  <span>Tarifas e ajustes</span>
                  <b>
                    <Money
                      value={details.feeTotal + details.adjustmentTotal}
                    />
                  </b>
                </div>
                <div className="primary">
                  <span>
                    {invoice.totalSource === "calculated_transactions"
                      ? "Total estimado"
                      : "Total exibido"}
                  </span>
                  <b>
                    <Money value={details.displayedTotal} />
                  </b>
                </div>
              </section>

              {invoice.totalSource === "calculated_transactions" ? (
                <p className="invoice-details-estimate">
                  Esta fatura foi estimada com base nas movimentações disponíveis.
                </p>
              ) : null}

              <details className="invoice-calculation">
                <summary>Como este total foi calculado?</summary>
                <dl>
                  <div>
                    <dt>Compras</dt>
                    <dd>
                      <Money value={details.purchaseTotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>Estornos</dt>
                    <dd>
                      <Money value={-details.refundTotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>Créditos</dt>
                    <dd>
                      <Money value={-details.creditTotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>Tarifas</dt>
                    <dd>
                      <Money value={details.feeTotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>Ajustes</dt>
                    <dd>
                      <Money value={details.adjustmentTotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>Total calculado</dt>
                    <dd>
                      <Money value={details.calculatedTotal} />
                    </dd>
                  </div>
                </dl>
                {details.providerTotal === null ? (
                  <p>Não foi possível comparar com uma fatura oficial.</p>
                ) : (
                  <div className="invoice-reconciliation">
                    <span>
                      Total oficial: <Money value={details.providerTotal} />
                    </span>
                    <span>
                      Diferença:{" "}
                      <Money value={details.reconciliationDifference || 0} />
                    </span>
                    <span>Status: {details.reconciliationStatus}</span>
                  </div>
                )}
              </details>

              {unassigned.length ? (
                <aside className="invoice-unassigned-summary">
                  <div>
                    <b>Sem cartão identificado</b>
                    <span>
                      {unassigned.length} lançamentos ·{" "}
                      <Money value={unassignedTotal} />
                    </span>
                  </div>
                  <Link
                    href={`/financeiro/cartoes/${invoice.card.id}?instrumento=unassigned`}
                  >
                    Revisar
                  </Link>
                </aside>
              ) : null}

              <section className="invoice-accounted">
                <header>
                  <div>
                    <h3>Compras contabilizadas</h3>
                    <p>
                      {details.includedPurchases.length} lançamentos usados no
                      cálculo
                    </p>
                  </div>
                  <select
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value);
                      setLimit(20);
                    }}
                    aria-label="Ordenar lançamentos"
                  >
                    <option value="recent">Mais recentes</option>
                    <option value="oldest">Mais antigas</option>
                    <option value="largest">Maior valor</option>
                    <option value="smallest">Menor valor</option>
                  </select>
                </header>
                <label className="invoice-details-search">
                  <span className="sr-only">Buscar lançamento</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setLimit(20);
                    }}
                    placeholder="Buscar compra, categoria, cartão ou origem"
                  />
                </label>
                <nav className="invoice-details-filters" aria-label="Filtros">
                  {filters.map(([value, label]) => (
                    <button
                      type="button"
                      className={filter === value ? "active" : undefined}
                      aria-pressed={filter === value}
                      onClick={() => {
                        setFilter(value);
                        setLimit(20);
                      }}
                      key={value}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
                {invoice.card.credit_card_instruments?.length ? (
                  <label className="invoice-instrument-filter">
                    <span>Instrumento</span>
                    <select
                      value={instrument}
                      onChange={(event) => {
                        setInstrument(event.target.value);
                        setLimit(20);
                      }}
                    >
                      <option value="all">Todos</option>
                      {invoice.card.credit_card_instruments.map((item) => (
                        <option value={item.id} key={item.id}>
                          final {item.last_four_digits || "não informado"}
                        </option>
                      ))}
                      <option value="unassigned">Sem identificação</option>
                    </select>
                  </label>
                ) : null}

                {groups.size ? (
                  <div className="invoice-details-groups">
                    {[...groups].map(([date, purchases]) => (
                      <section key={date}>
                        <h4>
                          {new Intl.DateTimeFormat("pt-BR", {
                            day: "2-digit",
                            month: "long",
                            timeZone: "UTC",
                          }).format(new Date(`${date}T12:00:00Z`))}
                        </h4>
                        {purchases.map((purchase) => (
                          <PurchaseDetails
                            invoice={invoice}
                            purchase={purchase}
                            key={purchase.id}
                          />
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="invoice-details-empty">
                    <b>Nenhuma compra foi encontrada neste ciclo.</b>
                    <p>
                      Período: {formatDate(invoice.cycle.cycleStart)} a{" "}
                      {formatDate(invoice.cycle.cycleEnd)}
                    </p>
                    <small>
                      Última sincronização:{" "}
                      {formatDate(invoice.card.last_sync_at)}
                    </small>
                  </div>
                )}
                {visible.length < filtered.length ? (
                  <button
                    type="button"
                    className="invoice-details-load-more"
                    onClick={() => setLimit((current) => current + 20)}
                  >
                    Carregar mais
                  </button>
                ) : null}
              </section>

              {details.linkedPayments.length ? (
                <details className="invoice-excluded">
                  <summary>Pagamento vinculado</summary>
                  <p>
                    Este pagamento pertence ao caixa bancário e não forma o
                    total de consumo.
                  </p>
                  {details.linkedPayments.map((payment) => (
                    <span key={payment.id}>
                      <span>
                        <b>{payment.description}</b>
                        <small>{formatDate(purchaseCompetenceDate(payment))}</small>
                      </span>
                      <Money value={Number(payment.installment_amount)} />
                    </span>
                  ))}
                </details>
              ) : null}

              {details.excludedItems.length ? (
                <details className="invoice-excluded">
                  <summary>
                    Lançamentos não considerados ({details.excludedItems.length})
                  </summary>
                  {details.excludedItems.slice(0, 20).map(({ purchase, reason }) => (
                    <span key={`${reason}-${purchase.id}`}>
                      <span>
                        <b>{purchase.description}</b>
                        <small>{exclusionLabels[reason]}</small>
                      </span>
                      <Money value={Number(purchase.installment_amount)} />
                    </span>
                  ))}
                </details>
              ) : null}
            </>
          )}
        </div>

        <footer className="invoice-details-footer">
          <Link href={`/financeiro/cartoes/${invoice.card.id}`}>
            Ver na página de cartões
          </Link>
          <button type="button" onClick={close}>
            Fechar
          </button>
        </footer>
      </section>
    </div>
  );

  return (
    <>
      {trigger}
      {typeof document === "undefined" ? null : createPortal(drawer, document.body)}
    </>
  );
}
