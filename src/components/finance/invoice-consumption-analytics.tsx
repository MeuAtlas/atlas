import type { CSSProperties } from "react";
import type { InvoiceHistoryAnalytics, StatementHistoryStatus } from "@/modules/finance/invoice-history";
import { Money } from "./value-visibility";

const shortMonth = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${month}-01T12:00:00Z`))
    .replace(" de ", "/")
    .replace(".", "");

function comparisonLabel(analytics: InvoiceHistoryAnalytics) {
  if (analytics.currentDifference === null || analytics.currentDifferencePercentage === null) {
    return "Comparação disponível após o primeiro pagamento confirmado.";
  }
  if (analytics.currentPosition === "equal") return "Igual à referência das faturas pagas";
  const direction = analytics.currentPosition === "above" ? "acima" : "abaixo";
  return `${Math.abs(analytics.currentDifferencePercentage).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}% ${direction} da referência`;
}

const legendLabels: Partial<Record<StatementHistoryStatus, string>> = {
  paid: "Pago",
  open: "Em aberto",
  closed_unpaid: "Aguardando pagamento",
  payment_detected: "Pagamento encontrado",
  partially_paid: "Pagamento parcial",
  estimated: "Estimativa",
};

export function InvoiceConsumptionAnalytics({ analytics }: { analytics: InvoiceHistoryAnalytics }) {
  const points = analytics.months.filter(month => month.item.displayAmount !== null);
  const current = [...points].reverse().find(point => point.item.isCurrentOpenStatement)?.item ?? null;
  const paidCount = analytics.months.filter(month => month.item.participatesInMedian).length;
  const maximum = Math.max(1, ...points.map(point => point.total));
  const statuses = [...new Set(points.map(point => point.item.status))];

  return (
    <section className="invoice-consumption-analytics" aria-labelledby="invoice-consumption-title" data-testid="invoice-consumption-analytics">
      <header>
        <div>
          <p className="eyebrow">Histórico de consumo</p>
          <h3 id="invoice-consumption-title">Evolução das faturas</h3>
          <p>Faturas organizadas pelo mês em que foram ou serão pagas, com destaque para a fatura ainda aberta.</p>
        </div>
        <span className={`invoice-consumption-position ${analytics.currentPosition}`}>
          {comparisonLabel(analytics)}
        </span>
      </header>

      <div className="invoice-consumption-metrics">
        <article>
          <small>Referência das faturas pagas</small>
          <strong>{analytics.median === null ? "Aguardando histórico" : <Money value={analytics.median} />}</strong>
          <span>{paidCount} {paidCount === 1 ? "fatura confirmada" : "faturas confirmadas"}</span>
        </article>
        <article>
          <small>{current ? `Fatura de ${current.monthLabel}` : "Fatura em aberto"}</small>
          <strong>{current?.displayAmount == null ? "Indisponível" : <Money value={current.displayAmount} />}</strong>
          <span>{current?.statusLabel ?? "Nenhuma fatura vigente identificada"}</span>
        </article>
        <article>
          <small>Situação</small>
          <strong>{current?.closingDate ? `Fecha em ${current.tooltip.closingLabel}` : current?.statusLabel ?? "Sem pendências"}</strong>
          <span>{current?.dueDate ? `Vence em ${current.tooltip.dueLabel}` : "Aguardando novo ciclo"}</span>
        </article>
        <article>
          <small>Comparação</small>
          <strong className={analytics.currentPosition === "above" ? "negative" : "positive"}>
            {analytics.currentDifferencePercentage === null
              ? "Indisponível"
              : `${Math.abs(analytics.currentDifferencePercentage).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${analytics.currentPosition === "above" ? "acima" : "abaixo"}`}
          </strong>
          <span>{analytics.currentDifference === null ? "Sem referência" : <><Money value={Math.abs(analytics.currentDifference)} /> de diferença</>}</span>
        </article>
      </div>

      {points.length ? (
        <>
          <div className="invoice-consumption-chart-shell">
            <div className="invoice-consumption-chart" role="list" aria-label="Faturas por mês de pagamento">
              {points.map(point => {
                const item = point.item;
                return (
                  <div className={item.status} key={point.month} role="listitem">
                    <details className="invoice-consumption-tooltip">
                      <summary
                        style={{ "--invoice-bar-height": `${Math.max(5, (point.total / maximum) * 100)}%` } as CSSProperties}
                        aria-label={`${item.monthLabel}: ${point.total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}, ${item.statusLabel}`}
                      >
                        <span />
                      </summary>
                      <div>
                        <b>{item.tooltip.title}</b>
                        <strong><Money value={point.total} /></strong>
                        <span>Situação <em>{item.tooltip.statusLabel}</em></span>
                        {item.tooltip.paymentLabel ? <span>Pagamento <em>{item.tooltip.paymentLabel}</em></span> : null}
                        {item.tooltip.cycleLabel ? <span>Ciclo de compras <em>{item.tooltip.cycleLabel}</em></span> : null}
                        {item.tooltip.closingLabel ? <span>Fechamento <em>{item.tooltip.closingLabel}</em></span> : null}
                        {item.tooltip.dueLabel ? <span>Vencimento <em>{item.tooltip.dueLabel}</em></span> : null}
                        <span>Fonte <em>{item.tooltip.sourceLabel}</em></span>
                        {item.invoiceCount > 1 ? <small>{item.invoiceCount} faturas consolidadas neste mês</small> : null}
                      </div>
                    </details>
                    <small>{shortMonth(point.month)}</small>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="invoice-consumption-legend" aria-label="Legenda">
            {statuses.flatMap(status => legendLabels[status] ? [<span className={status} key={status}><i />{legendLabels[status]}</span>] : [])}
          </div>
          <p className="invoice-consumption-note">
            Cada fatura reúne compras realizadas durante o ciclo anterior; o mês da coluna representa o pagamento esperado ou confirmado.
          </p>
        </>
      ) : (
        <p className="invoice-consumption-empty">As faturas aparecerão aqui quando houver um total confiável ou um pagamento confirmado.</p>
      )}
    </section>
  );
}
