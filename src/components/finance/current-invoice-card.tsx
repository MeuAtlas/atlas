import Link from "next/link";
import { InvoiceDetailsDrawer } from "./invoice-details-drawer";
import { Money } from "./value-visibility";
import { formatDate } from "@/modules/finance/format";
import {
  getCurrentBillSummary,
  getEstimatedInvoiceDetails,
  type CurrentCardInvoice,
} from "@/modules/finance/card-invoices";
import { installmentLabel } from "@/modules/finance/installments";
import { CurrentInvoiceCompactCard } from "./current-invoice-compact-card";
import type { ResolvedOpenCardInvoice } from "@/modules/finance/open-card-invoice";
import type { ResolvedCardCycleDetails } from "@/modules/finance/resolved-card-cycle-details";
import { persistedCardMovementAmountBrl } from "@/modules/finance/foreign-card-movement";

export function CurrentInvoiceCard({
  invoice,
  compact = false,
  forcePartial = false,
  resolvedInvoice,
  resolvedDetails,
}: {
  invoice: CurrentCardInvoice;
  compact?: boolean;
  forcePartial?: boolean;
  resolvedInvoice?: ResolvedOpenCardInvoice;
  resolvedDetails?: ResolvedCardCycleDetails;
}) {
  if (compact) {
    return (
      <CurrentInvoiceCompactCard
        invoice={invoice}
        forcePartial={forcePartial}
        resolvedInvoice={resolvedInvoice}
        resolvedDetails={resolvedDetails}
      />
    );
  }

  const { card, cycle } = invoice;
  const details = getEstimatedInvoiceDetails(invoice);
  const billSummary = getCurrentBillSummary(invoice);
  const partial=forcePartial||
    resolvedInvoice?.detailsCompleteness==="partial"||
    resolvedInvoice?.detailsCompleteness==="unavailable"||
    invoice.isPartial;
  const manualDate=cycle?card.card_invoice_confirmations?.find(item=>item.reference_month.slice(0,7)===cycle.referenceMonth)?.informed_at:null;
  const sourceDate=billSummary.amountSource==="provider_bill"||partial?card.bank_connections?.last_complete_sync_at:billSummary.amountSource==="manual_bank_confirmation"?manualDate:card.last_sync_at;
  const displayedTotal=resolvedInvoice?resolvedInvoice.displayTotal:billSummary.amount;
  const ownerPayableTotal=displayedTotal===null?null:Math.max(0,displayedTotal-invoice.thirdPartyResponsibleTotal);
  const risk =
    invoice.usedPercent > 90
      ? "danger"
      : invoice.usedPercent >= 75
        ? "warning"
        : invoice.usedPercent >= 50
          ? "attention"
          : "normal";

  return (
    <article className="current-invoice-card">
      <header>
        <span>
          <b>{card.name}</b>
          <small>
            {card.brand || card.institution_name || "Cartão"} ·{" "}
            {card.last_four_digits || "••••"}
          </small>
        </span>
        {card.source === "pluggy" ? <i>Pluggy</i> : null}
      </header>
      {cycle ? (
        <>
          <div className="invoice-total">
            <small>{billSummary.statusLabel}</small>
            {partial?<span className="invoice-source-badge is-partial">Dados parciais</span>:null}
            <strong>
              {(resolvedInvoice
                ? resolvedInvoice.displayTotal
                : billSummary.amount) === null ? (
                "Indisponível"
              ) : (
                <Money value={resolvedInvoice
                  ? resolvedInvoice.displayTotal!
                  : billSummary.amount!} />
              )}
            </strong>
            <span>
              {billSummary.purchasesCount === null
                ? "Compras temporariamente indisponíveis"
                : `${billSummary.purchasesCount} compras identificadas`}
            </span>
            <span>Fonte: {resolvedInvoice?.sourceLabel ?? (billSummary.resolvedSource==="provider_bill"?"Oficial":billSummary.resolvedSource==="manual"||billSummary.resolvedSource==="confirmed"?"Confirmada":billSummary.resolvedSource==="last_reliable"?"Último valor confiável":billSummary.resolvedSource==="calculated"?"Calculada pelas compras":"Indisponível")}</span>
            {(resolvedInvoice?.updatedAt ?? sourceDate)?<span>Fonte atualizada em {formatDate(resolvedInvoice?.updatedAt ?? sourceDate ?? null)}</span>:null}
            {(resolvedInvoice?.detailedTotal ?? invoice.calculatedInvoiceTotal) !== null ? <span>Movimentações conciliadas: <Money value={resolvedInvoice?.detailedTotal ?? invoice.calculatedInvoiceTotal}/></span> : null}
            {(resolvedInvoice?.reconciliationDifference ?? invoice.reconciliationDifference) !== null && Math.abs((resolvedInvoice?.reconciliationDifference ?? invoice.reconciliationDifference)!) > 0.01 ? <span className="invoice-difference">Diferença ainda não detalhada: <Money value={Math.abs((resolvedInvoice?.reconciliationDifference ?? invoice.reconciliationDifference)!)}/></span> : null}
            {invoice.thirdPartyResponsibleTotal>0&&ownerPayableTotal!==null?<><span>Responsabilidade de outras pessoas: − <Money value={invoice.thirdPartyResponsibleTotal}/></span><span><b>Sua parte estimada: <Money value={ownerPayableTotal}/></b></span></>:null}
          </div>
          <div className="invoice-dates">
            <span>
              Período: {formatDate(billSummary.periodStart)} a {formatDate(billSummary.periodEnd)}{invoice.cycleEstimated ? " · estimado" : ""}
            </span>
            <span>
              Fecha em {formatDate(billSummary.closesAt)} · vence em{" "}
              {formatDate(billSummary.dueAt)}
            </span>
          </div>
          {details.includedPurchases.length ? (
            <div className="invoice-purchase-preview">
              {details.includedPurchases
                .filter((purchase) => purchase.transaction_role === "consumption")
                .slice(0, compact ? 3 : 5)
                .map((purchase) => (
                  <span key={purchase.id}>
                    <span>
                      <b>{purchase.description}</b>
                      {installmentLabel(purchase,compact) ? <small>{installmentLabel(purchase,compact)}</small> : null}
                    </span>
                    <strong>
                      {persistedCardMovementAmountBrl(purchase) === null
                        ? "ConversÃ£o indisponÃ­vel"
                        : <Money value={persistedCardMovementAmountBrl(purchase)!}/>}
                    </strong>
                  </span>
                ))}
            </div>
          ) : null}
          {invoice.instrumentTotals.length || invoice.unassignedCount ? (
            <div className="card-instrument-list">
              <small>Cartões vinculados</small>
              {invoice.instrumentTotals
                .filter((total) => !card.credit_card_instruments?.find(instrument=>instrument.id===total.instrumentId)?.user_archived_at)
                .map((total) => (
                  <span key={total.instrumentId}>
                    <span>{total.cardKind === "unknown"
                      ? "Cartão"
                      : total.cardKind === "physical"
                        ? "Físico"
                        : total.cardKind === "additional"
                          ? "Adicional"
                          : total.cardKind === "virtual"
                            ? "Virtual"
                            : "Online"}{" "}
                    · {total.lastFour || "••••"}</span>
                    <strong><Money value={total.netTotal}/></strong>
                    <small>{total.purchaseCount} compras{total.responsiblePersonName?` · paga por ${total.responsiblePersonName}`:""}</small>
                  </span>
                ))}
              {invoice.unassignedCount ? <span><span>Sem cartão identificado</span><strong><Money value={invoice.unassignedTotal}/></strong><small>{invoice.unassignedCount} lançamentos</small></span>:null}
              {invoice.unassignedCount ? <Link href={`/financeiro/cartoes/${card.id}?instrumento=unassigned`}>Revisar lançamentos</Link>:null}
            </div>
          ) : null}
          {!compact ? (
            invoice.availableLimit===null ? (
              <div className="limit-caption">
                <span>Limite não informado</span>
              </div>
            ) : <>
              <div
                className="limit-progress"
                role="progressbar"
                aria-label="Percentual do limite utilizado"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(invoice.usedPercent)}
              >
                <span className={risk} style={{ width: `${invoice.usedPercent}%` }} />
              </div>
              <div className="limit-caption">
                <span>Limite utilizado: {Math.round(invoice.usedPercent)}%</span>
                <span>
                  Disponível: <Money value={invoice.availableLimit} />
                </span>
              </div>
            </>
          ) : null}
          {invoice.reconciliationStatus === "divergent" ? (
            <p className="invoice-warning">
              Existem lançamentos da fatura que ainda não foram totalmente conciliados pelo Atlas.
            </p>
          ) : null}
          {billSummary.warningMessage ? (
            <p className="invoice-warning">{billSummary.warningMessage}</p>
          ) : null}
          <footer>
            <small>
              {card.last_sync_at
                ? `Atualizado em ${formatDate(card.last_sync_at)}`
                : "Ainda não sincronizado"}
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
          <a href={`#configurar-${card.id}`}>Configurar cartão</a>
        </div>
      )}
    </article>
  );
}
