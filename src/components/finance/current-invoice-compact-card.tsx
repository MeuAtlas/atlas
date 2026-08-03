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
        {partial ? "Atualizada parcialmente" : summary.amountSourceLabel}
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
    ? resolvedInvoice?.displayTotalSource === "calculated"
      ? "Estimativa baseada nas compras sincronizadas. O valor pode aumentar até o fechamento."
      : "Compras ainda em conciliação. O valor informado permanece disponível."
    : forcePartial
      ? "Alguns dados podem estar incompletos."
      : summary.warningMessage;
  const displayAmount = resolvedInvoice
    ? resolvedInvoice.displayTotal
    : summary.displayAmount;
  const ownerPayableAmount=displayAmount===null?null:Math.max(0,displayAmount-invoice.thirdPartyResponsibleTotal);
  const lastUpdatedAt = resolvedInvoice?.updatedAt ?? summary.lastUpdatedAt;
  const instrumentTotals = invoice.instrumentTotals.filter((total) => {
    const instrument = invoice.card.credit_card_instruments?.find(
      (item) => item.id === total.instrumentId,
    );
    return !instrument?.user_archived_at && total.purchaseCount > 0;
  });

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

          {invoice.thirdPartyResponsibleTotal>0&&ownerPayableAmount!==null?(
            <div className="invoice-responsibility-summary">
              <span><small>Total da fatura do banco</small><strong><Money value={displayAmount!}/></strong></span>
              <span><small>Responsabilidade de outras pessoas</small><strong>− <Money value={invoice.thirdPartyResponsibleTotal}/></strong></span>
              <span><small>Sua parte estimada</small><strong><Money value={ownerPayableAmount}/></strong></span>
            </div>
          ):null}

          {instrumentTotals.length ? (
            <div className="invoice-instrument-breakdown">
              <small>Consumo identificado por cartão</small>
              {instrumentTotals.map((total) => {
                const label =
                  total.lastFour === summary.lastFour
                    ? "Titular"
                    : total.cardKind === "additional"
                      ? "Adicional"
                      : total.cardKind === "virtual"
                        ? "Virtual"
                        : total.cardKind === "online"
                          ? "Online"
                          : total.cardKind === "physical"
                            ? "Físico"
                            : total.displayName || "Cartão";
                return (
                  <span key={total.instrumentId}>
                    <span>
                      <b>{label} · final {total.lastFour || "••••"}</b>
                      <small>
                        {total.purchaseCount}{" "}
                        {total.purchaseCount === 1 ? "compra" : "compras"}
                        {total.responsiblePersonName?` · paga por ${total.responsiblePersonName}`:""}
                      </small>
                    </span>
                    <strong><Money value={total.netTotal} /></strong>
                  </span>
                );
              })}
              {invoice.unassignedCount ? (
                <span>
                  <span>
                    <b>Cartão não identificado</b>
                    <small>{invoice.unassignedCount} lançamentos</small>
                  </span>
                  <strong><Money value={invoice.unassignedTotal} /></strong>
                </span>
              ) : null}
            </div>
          ) : null}

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
