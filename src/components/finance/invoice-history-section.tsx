"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ClientSearchForm, useClientNavigation } from "@/components/navigation/client-navigation";
import { Money } from "./value-visibility";
import { formatDate } from "@/modules/finance/format";
import type {
  CreditCardInvoiceHistoryItem,
  CreditCardInvoiceHistoryResult,
  HistoricalInvoiceStatus,
} from "@/modules/finance/invoice-history";
import type { CreditCard } from "@/modules/finance/types";
import { persistedCardMovementAmountBrl } from "@/modules/finance/foreign-card-movement";

const statusLabels: Record<HistoricalInvoiceStatus, string> = {
  paid: "Paga",
  closed: "Fechada",
  due: "Vence hoje",
  partially_paid: "Parcialmente paga",
  overdue: "Vencida",
  cancelled: "Cancelada",
};

const sourceLabels = {
  provider_bill: "Oficial da Pluggy",
  manual_pdf_confirmation: "Confirmada pela fatura PDF",
  manual_bank_confirmation: "Informada manualmente",
  confirmed_by_full_payment: "Confirmada pelo pagamento integral",
  calculated_transactions: "Calculada pelas movimentações",
  unavailable: "Dados indisponíveis",
} as const;

const reconciliationLabels: Record<string, string> = {
  matched: "Conciliada",
  small_difference: "Pequena diferença",
  divergent: "Revisão necessária",
  incomplete_assignment: "Dados parciais",
  provider_unavailable: "Sem total oficial",
  incomplete_transactions: "Dados parciais",
  incomplete: "Incompleta",
  unavailable: "Indisponível",
};

const monthLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

function InvoicePaymentSummary({
  invoice,
}: {
  invoice: CreditCardInvoiceHistoryItem;
}) {
  if (!invoice.payments.length && invoice.paidAmount <= 0) return null;
  const payment = invoice.payments[0];
  return (
    <section className="previous-invoice-payment">
      <h3>Pagamento da fatura</h3>
      <dl>
        <div>
          <dt>Data</dt>
          <dd>{formatDate(invoice.paidAt)}</dd>
        </div>
        <div>
          <dt>Conta pagadora</dt>
          <dd>
            {invoice.payingAccountName ??
              "Conta não identificada"}
          </dd>
        </div>
        <div>
          <dt>Valor</dt>
          <dd><Money value={invoice.paidAmount} /></dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{payment ? "Conciliado" : "Registrado na fatura"}</dd>
        </div>
      </dl>
    </section>
  );
}

function InvoiceTransactionsList({
  invoice,
}: {
  invoice: CreditCardInvoiceHistoryItem;
}) {
  if (!invoice.purchases.length && !invoice.pdfEntries?.length) {
    return (
      <p className="previous-invoice-no-transactions">
        Os lançamentos deste ciclo ainda não estão disponíveis.
      </p>
    );
  }
  return (
    <section className="previous-invoice-transactions">
      <h3>{invoice.purchaseCount} lançamentos identificados pelo Atlas</h3>
      {invoice.reconciliationDifference !== null &&
      invoice.reconciliationDifference > 0.01 ? (
        <p className="previous-invoice-reconciliation-warning" role="status">
          Existem <Money value={invoice.reconciliationDifference} /> ainda não
          detalhados nos lançamentos importados.
        </p>
      ) : null}
      <div>
        {invoice.pdfEntries?.map((entry) => (
          <article key={entry.id}>
            <span>
              <b>{entry.description}</b>
              <small>
                {formatDate(entry.transactionDate)} · Documento PDF
                {entry.reconciledWithProvider ? " · Conciliado com Pluggy" : ""}
              </small>
              <small>
                {entry.cardLastFour ? `Cartão final ${entry.cardLastFour}` : "Cartão principal"}
                {entry.installmentTotal ? ` · Parcela ${entry.installmentNumber}/${entry.installmentTotal}` : ""}
                {" · "}{Math.round(entry.confidence * 100)}% de confiança
              </small>
            </span>
            <Money value={entry.amount} />
          </article>
        ))}
        {invoice.purchases.map((purchase) => (
          <article key={purchase.id}>
            <span>
              <b>{purchase.description}</b>
              <small>
                {formatDate(purchase.competence_date || purchase.purchase_date)}
                {" · "}
                {purchase.financial_categories?.name ||
                  purchase.provider_category ||
                  "Sem categoria"}
              </small>
              <small>
                {purchase.credit_card_instruments?.last_four_digits
                  ? `Cartão final ${purchase.credit_card_instruments.last_four_digits}`
                  : invoice.lastFour
                    ? `Cartão final ${invoice.lastFour}`
                    : "Instrumento não identificado"}
                {purchase.installment_count && purchase.installment_count > 1
                  ? ` · Parcela ${purchase.installment_number}/${purchase.installment_count}`
                  : ""}
              </small>
              <small>
                {purchase.status} · {purchase.source} ·{" "}
                {purchase.review_status === "reviewed"
                  ? "Conciliado"
                  : "Aguardando revisão"}
              </small>
            </span>
            <Money
              value={
                ["refund"].includes(purchase.transaction_role)
                  ? -(persistedCardMovementAmountBrl(purchase) ?? 0)
                  : persistedCardMovementAmountBrl(purchase) ?? 0
              }
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function PreviousInvoiceDetailsDrawer({
  invoice,
  onClose,
}: {
  invoice: CreditCardInvoiceHistoryItem;
  onClose: () => void;
}) {
  const navigate = useClientNavigation();
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [reprocessing, setReprocessing] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);
  async function reprocess() {
    if (!invoice.documentId) return;
    setReprocessing(true); setDocumentError(null);
    const response = await fetch(`/api/invoice-imports/${invoice.documentId}/reprocess`, { method: "POST" });
    const body = await response.json();
    if (!response.ok) {
      setDocumentError(body.error?.message ?? "Não foi possível reprocessar o documento.");
      setReprocessing(false); return;
    }
    navigate(`/financeiro/cartoes/importar-fatura?document=${invoice.documentId}`);
  }
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && drawerRef.current) {
        const focusable = [
          ...drawerRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ),
        ];
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
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.classList.add("finance-sheet-open");
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("finance-sheet-open");
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const drawer = (
    <div className="previous-invoice-backdrop" onMouseDown={onClose}>
      <aside
        ref={drawerRef}
        className="previous-invoice-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="previous-invoice-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">Fatura anterior</p>
            <h2 id="previous-invoice-title">{invoice.cardName}</h2>
            <small>
              {invoice.brand || "Cartão"} ·{" "}
              {invoice.lastFour || "••••"}
            </small>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Fechar detalhes">
            ×
          </button>
        </header>
        <div className="previous-invoice-drawer-content">
          <dl className="previous-invoice-detail-grid">
            <div>
              <dt>Total confirmado da fatura</dt>
              <dd>{invoice.total === null ? "Indisponível" : <Money value={invoice.total} />}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{statusLabels[invoice.status]}</dd>
            </div>
            <div>
              <dt>Período</dt>
              <dd>{formatDate(invoice.cycleStartDate)} a {formatDate(invoice.cycleEndDate)}</dd>
            </div>
            <div>
              <dt>Fechamento</dt>
              <dd>{formatDate(invoice.closingDate)}</dd>
            </div>
            <div>
              <dt>Vencimento</dt>
              <dd>{formatDate(invoice.dueDate)}</dd>
            </div>
            <div>
              <dt>Lançamentos identificados</dt>
              <dd>{invoice.calculatedTotal === null ? "Indisponível" : <Money value={invoice.calculatedTotal} />}</dd>
            </div>
            <div>
              <dt>Fonte</dt>
              <dd>{sourceLabels[invoice.totalSource]}</dd>
            </div>
            <div>
              <dt>Conciliação</dt>
              <dd>{reconciliationLabels[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}</dd>
            </div>
            <div>
              <dt>Diferença ainda não detalhada</dt>
              <dd>{invoice.reconciliationDifference === null ? "Indisponível" : <Money value={Math.abs(invoice.reconciliationDifference)} />}</dd>
            </div>
          </dl>
          {invoice.totalSource === "confirmed_by_full_payment" &&
          invoice.reconciliationStatus === "incomplete" ? (
            <p className="previous-invoice-confirmation-note">
              O valor total foi confirmado pelo pagamento integral da fatura.
              Parte dos lançamentos ainda não foi identificada pela integração.
            </p>
          ) : null}
          <InvoicePaymentSummary invoice={invoice} />
          {invoice.documentId ? (
            <section className="previous-invoice-payment">
              <h3>Documento oficial</h3>
              <a className="invoice-import-link compact" href={`/api/invoice-imports/${invoice.documentId}/pdf`} target="_blank" rel="noreferrer">
                Abrir fatura em PDF
              </a>
              <button className="invoice-reprocess-button" type="button" onClick={reprocess} disabled={reprocessing}>
                {reprocessing ? "Reprocessando…" : "Reprocessar documento"}
              </button>
              {documentError ? <p className="invoice-review-warning" role="alert">{documentError}</p> : null}
            </section>
          ) : null}
          <InvoiceTransactionsList invoice={invoice} />
        </div>
      </aside>
    </div>
  );
  return createPortal(drawer, document.body);
}

function PreviousInvoiceCard({
  invoice,
  onOpen,
}: {
  invoice: CreditCardInvoiceHistoryItem;
  onOpen: () => void;
}) {
  return (
    <article className="previous-invoice-card">
      <header>
        <span>
          <b>{invoice.cardName}</b>
          <small>{invoice.brand || "Cartão"} · {invoice.lastFour || "••••"}</small>
        </span>
        <i className={`invoice-status ${invoice.status}`}>{statusLabels[invoice.status]}</i>
      </header>
      <div className="previous-invoice-total">
        <small>Total confirmado</small>
        <strong>{invoice.total === null ? "Indisponível" : <Money value={invoice.total} />}</strong>
      </div>
      <dl>
        <div><dt>Período</dt><dd>{formatDate(invoice.cycleStartDate)} a {formatDate(invoice.cycleEndDate)}</dd></div>
        <div><dt>Fechamento</dt><dd>{formatDate(invoice.closingDate)}</dd></div>
        <div><dt>Vencimento</dt><dd>{formatDate(invoice.dueDate)}</dd></div>
        <div><dt>Lançamentos identificados</dt><dd>{invoice.calculatedTotal === null ? "Indisponível" : <Money value={invoice.calculatedTotal} />}</dd></div>
        {invoice.paidAmount > 0 ? (
          <div><dt>Valor pago</dt><dd><Money value={invoice.paidAmount} /></dd></div>
        ) : null}
        {invoice.paidAt ? <div><dt>Pagamento</dt><dd>{formatDate(invoice.paidAt)}</dd></div> : null}
        <div><dt>Conciliação</dt><dd>{reconciliationLabels[invoice.reconciliationStatus] ?? "Dados parciais"}</dd></div>
      </dl>
      <footer>
        <span>
          <small>{sourceLabels[invoice.totalSource]}</small>
          <small>{reconciliationLabels[invoice.reconciliationStatus] ?? "Dados parciais"}</small>
        </span>
        <button type="button" onClick={onOpen}>Ver detalhes</button>
      </footer>
    </article>
  );
}

export function InvoiceHistorySection({
  result,
  cards,
  years,
  filters,
  nextHref,
  error,
  initialInvoiceId,
}: {
  result: CreditCardInvoiceHistoryResult;
  cards: CreditCard[];
  years: number[];
  filters: {
    card?: string;
    year?: string;
    status?: string;
    period?: string;
    query?: string;
  };
  nextHref: string | null;
  error?: boolean;
  initialInvoiceId?: string;
}) {
  const router = useRouter();
  const [filterOpen, setFilterOpen] = useState(false);
  const [selected, setSelected] = useState<CreditCardInvoiceHistoryItem | null>(
    () => result.invoices.find(item => item.id === initialInvoiceId) ?? null,
  );
  const search = (filters.query ?? "").trim().toLocaleLowerCase("pt-BR");
  const visible = useMemo(
    () =>
      result.invoices.filter((invoice) => {
        if (!search) return true;
        const haystack = [
          invoice.cardName,
          invoice.lastFour,
          invoice.brand,
          monthLabel(invoice.dueDate),
          invoice.dueDate.slice(0, 4),
          ...invoice.purchases.map((purchase) => purchase.description),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("pt-BR");
        return haystack.includes(search);
      }),
    [result.invoices, search],
  );
  const groups = Map.groupBy(visible, (invoice) => invoice.dueDate.slice(0, 7));

  return (
    <section className="invoice-history-section">
      <header className="invoice-history-heading">
        <div>
          <p className="eyebrow">Crédito e faturas</p>
          <h2>Faturas anteriores</h2>
          <p>Consulte ciclos fechados, seus lançamentos e pagamentos.</p>
        </div>
        <button type="button" className="invoice-filter-trigger" onClick={() => setFilterOpen(true)}>
          Filtros
        </button>
      </header>

      <ClientSearchForm action="/financeiro/cartoes" className={`invoice-history-filters${filterOpen ? " open" : ""}`}>
        <div className="invoice-filter-sheet-header">
          <b>Filtrar faturas</b>
          <button type="button" onClick={() => setFilterOpen(false)} aria-label="Fechar filtros">×</button>
        </div>
        <input type="hidden" name="view" value="history" />
        <label>
          <span>Buscar</span>
          <input name="q" type="search" defaultValue={filters.query} placeholder="Cartão, compra, mês ou ano" />
        </label>
        <label>
          <span>Cartão</span>
          <select name="card" defaultValue={filters.card}>
            <option value="">Todos os cartões</option>
            {cards.map((card) => (
              <option value={card.id} key={card.id}>
                {card.name} · {card.last_four_digits || "••••"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Ano</span>
          <select name="year" defaultValue={filters.year}>
            <option value="">Todos</option>
            {years.map((year) => <option value={year} key={year}>{year}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select name="status" defaultValue={filters.status}>
            <option value="">Todas</option>
            <option value="paid">Pagas</option>
            <option value="closed">Fechadas</option>
            <option value="partially_paid">Parcialmente pagas</option>
            <option value="overdue">Vencidas</option>
            <option value="cancelled">Canceladas</option>
          </select>
        </label>
        <label>
          <span>Período</span>
          <select name="period" defaultValue={filters.period}>
            <option value="">Todo o histórico</option>
            <option value="3m">Últimos 3 meses</option>
            <option value="6m">Últimos 6 meses</option>
            <option value="12m">Últimos 12 meses</option>
          </select>
        </label>
        <button type="submit">Aplicar filtros</button>
        <Link href="/financeiro/cartoes?view=history">Limpar</Link>
      </ClientSearchForm>

      {error ? (
        <div className="invoice-history-error" role="alert">
          <h3>Não foi possível carregar as faturas anteriores.</h3>
          <span>
            <button type="button" onClick={() => router.refresh()}>Tentar novamente</button>
            <Link href="/financeiro/cartoes?view=current">Voltar para fatura atual</Link>
          </span>
        </div>
      ) : null}
      {result.warnings.map((warning) => (
        <p className="invoice-history-warning" role="status" key={warning}>{warning}</p>
      ))}
      {!error && visible.length ? (
        <div className="invoice-history-groups">
          {[...groups.entries()].map(([month, invoices]) => (
            <section key={month}>
              <h3>{monthLabel(`${month}-01`)}</h3>
              <div className="previous-invoice-grid">
                {invoices.map((invoice) => (
                  <PreviousInvoiceCard
                    invoice={invoice}
                    onOpen={() => setSelected(invoice)}
                    key={invoice.id}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : !error ? (
        <div className="invoice-history-empty">
          <h3>Nenhuma fatura anterior encontrada</h3>
          <p>As faturas fechadas e pagas aparecerão aqui.</p>
          <Link href="/financeiro/cartoes?view=current">Voltar para fatura atual</Link>
        </div>
      ) : null}
      {nextHref ? <Link className="invoice-history-load-more" href={nextHref}>Próximas faturas</Link> : null}
      {selected ? <PreviousInvoiceDetailsDrawer invoice={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
