import { formatDate } from "@/modules/finance/format";
import {
  getCurrentInvoiceSummary,
  type CurrentCardInvoice,
  type CurrentInvoiceSummary,
} from "@/modules/finance/card-invoices";
import { InvoiceDetailsDrawer } from "./invoice-details-drawer";
import { Money } from "./value-visibility";
import type { ResolvedOpenCardInvoice } from "@/modules/finance/open-card-invoice";
import type { ResolvedCardCycleDetails } from "@/modules/finance/resolved-card-cycle-details";

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
  resolvedInvoice,
  resolvedDetails,
}: {
  invoice: CurrentCardInvoice;
  forcePartial?: boolean;
  resolvedInvoice?: ResolvedOpenCardInvoice;
  resolvedDetails?: ResolvedCardCycleDetails;
}) {
  const summary = getCurrentInvoiceSummary(invoice);
  const detailsPartial =
    resolvedInvoice?.detailsCompleteness === "partial" ||
    resolvedInvoice?.detailsCompleteness === "unavailable";
  const partialMessage = detailsPartial
    ? "Compras ainda em conciliação. O total confirmado permanece disponível."
    : forcePartial
      ? "Alguns dados podem estar incompletos."
      : summary.warningMessage;
  const displayAmount = resolvedInvoice
    ? resolvedInvoice.displayTotal
    : summary.displayAmount;
  const lastUpdatedAt = resolvedInvoice?.updatedAt ?? summary.lastUpdatedAt;

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
          <InvoiceStatusBadge
            summary={summary}
            forcePartial={forcePartial || detailsPartial}
          />

          <strong className="invoice-summary-amount">
            {displayAmount === null ? (
              "Valor indisponível"
            ) : (
              <Money value={displayAmount} />
            )}
          </strong>

          <div className="invoice-summary-metadata">
            <span>
              {formatDate(resolvedInvoice?.cycleStartDate ?? summary.cycleStart)} a{" "}
              {formatDate(resolvedInvoice?.cycleEndDate ?? summary.cycleEnd)}
            </span>
            <span>
              Fecha em {formatDate(resolvedInvoice?.closingDate ?? summary.closingDate)} · vence em{" "}
              {formatDate(resolvedInvoice?.dueDate ?? summary.dueDate)}
            </span>
            {resolvedInvoice ? (
              <span>
                {resolvedInvoice.sourceLabel}
                {resolvedInvoice.confirmedAt
                  ? ` em ${formatDate(resolvedInvoice.confirmedAt)}`
                  : ""}
              </span>
            ) : null}
            <span>
              {summary.purchaseCount === null
                ? resolvedInvoice?.displayTotal !== null
                  ? "Detalhamento parcial"
                  : "Compras temporariamente indisponíveis"
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
              {lastUpdatedAt
                ? `${
                    detailsPartial || summary.dataCompleteness==="partial"
                      ? "Atualização confiável"
                      : "Atualizado"
                  } em ${formatDate(lastUpdatedAt)}`
                : "Atualização indisponível"}
            </small>
            <InvoiceDetailsDrawer
              invoice={invoice}
              cycleDetails={resolvedDetails}
            />
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
