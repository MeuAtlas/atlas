import { formatDate } from "@/modules/finance/format";
import {
  getCurrentInvoiceSummary,
  type CurrentCardInvoice,
  type CurrentInvoiceSummary,
} from "@/modules/finance/card-invoices";
import { InvoiceDetailsDrawer } from "./invoice-details-drawer";
import { Money } from "./value-visibility";

function InvoiceStatusBadge({
  summary,
  forcePartial,
}: {
  summary: CurrentInvoiceSummary;
  forcePartial: boolean;
}) {
  const partial =
    forcePartial ||
    ["partial", "unavailable"].includes(summary.dataCompleteness);

  return (
    <div className="invoice-summary-badges">
      <span className={`invoice-status-badge status-${summary.status}`}>
        {summary.statusLabel}
      </span>
      <span
        className={`invoice-source-badge${partial ? " is-partial" : ""}`}
      >
        {partial ? "Dados parciais" : summary.amountSourceLabel}
      </span>
    </div>
  );
}

export function CurrentInvoiceCompactCard({
  invoice,
  forcePartial = false,
}: {
  invoice: CurrentCardInvoice;
  forcePartial?: boolean;
}) {
  const summary = getCurrentInvoiceSummary(invoice);
  const partialMessage = forcePartial
    ? "Alguns dados podem estar incompletos."
    : summary.warningMessage;

  return (
    <article className="current-invoice-card current-invoice-summary-card">
      <header>
        <span>
          <b>{summary.cardName}</b>
          <small>
            {summary.brand} · {summary.lastFour}
          </small>
        </span>
      </header>

      {invoice.cycle ? (
        <>
          <InvoiceStatusBadge summary={summary} forcePartial={forcePartial} />

          <strong className="invoice-summary-amount">
            {summary.displayAmount === null ? (
              "Valor indisponível"
            ) : (
              <Money value={summary.displayAmount} />
            )}
          </strong>

          <div className="invoice-summary-metadata">
            <span>
              {formatDate(summary.cycleStart)} a {formatDate(summary.cycleEnd)}
            </span>
            <span>
              Fecha em {formatDate(summary.closingDate)} · vence em{" "}
              {formatDate(summary.dueDate)}
            </span>
            <span>
              {summary.purchaseCount === null
                ? "Compras indisponíveis"
                : `${summary.purchaseCount} ${
                    summary.purchaseCount === 1 ? "compra" : "compras"
                  } no período`}
            </span>
          </div>

          {partialMessage ? (
            <p className="invoice-summary-notice">{partialMessage}</p>
          ) : null}

          <footer>
            <small>
              {summary.lastUpdatedAt
                ? `Atualizado em ${formatDate(summary.lastUpdatedAt)}`
                : "Atualização indisponível"}
            </small>
            <InvoiceDetailsDrawer invoice={invoice} />
          </footer>
        </>
      ) : (
        <div className="invoice-unconfigured">
          <p>Configure o fechamento do cartão para calcular o ciclo vigente.</p>
          <a href={`#configurar-${summary.cardId}`}>Configurar cartão</a>
        </div>
      )}
    </article>
  );
}
