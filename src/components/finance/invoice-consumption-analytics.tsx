import type { CSSProperties } from "react";
import type { InvoiceHistoryAnalytics } from "@/modules/finance/invoice-history";
import { Money } from "./value-visibility";

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${month}-01T12:00:00Z`))
    .replace(".", "");

function comparisonLabel(analytics: InvoiceHistoryAnalytics) {
  if (
    analytics.currentDifference === null ||
    analytics.currentDifferencePercentage === null
  ) {
    return "Comparação disponível após o primeiro histórico oficial.";
  }
  if (analytics.currentPosition === "equal") {
    return "A fatura vigente está igual à mediana mensal.";
  }
  const direction = analytics.currentPosition === "above" ? "acima" : "abaixo";
  return `${Math.abs(analytics.currentDifferencePercentage).toLocaleString(
    "pt-BR",
    { minimumFractionDigits: 1, maximumFractionDigits: 1 },
  )}% ${direction} da mediana`;
}

export function InvoiceConsumptionAnalytics({
  analytics,
}: {
  analytics: InvoiceHistoryAnalytics;
}) {
  const points = [
    ...analytics.months.map(month => ({
      key: month.month,
      label: monthLabel(month.month),
      total: month.total,
      current: false,
    })),
    ...(analytics.currentTotal === null
      ? []
      : [{
          key: "current",
          label: "Atual",
          total: analytics.currentTotal,
          current: true,
        }]),
  ];
  const maximum = Math.max(1, ...points.map(point => point.total));

  return (
    <section
      className="invoice-consumption-analytics"
      aria-labelledby="invoice-consumption-title"
      data-testid="invoice-consumption-analytics"
    >
      <header>
        <div>
          <p className="eyebrow">Histórico de consumo</p>
          <h3 id="invoice-consumption-title">Evolução das faturas</h3>
          <p>
            Totais oficiais das faturas fechadas comparados com a estimativa
            da fatura vigente.
          </p>
        </div>
        <span className={`invoice-consumption-position ${analytics.currentPosition}`}>
          {comparisonLabel(analytics)}
        </span>
      </header>

      <div className="invoice-consumption-metrics">
        <article>
          <small>Mediana mensal</small>
          <strong>
            {analytics.median === null
              ? "Aguardando histórico"
              : <Money value={analytics.median} />}
          </strong>
        </article>
        <article>
          <small>Fatura vigente</small>
          <strong>
            {analytics.currentTotal === null
              ? "Indisponível"
              : <Money value={analytics.currentTotal} />}
          </strong>
          <span>Maior valor entre o informado e a estimativa</span>
        </article>
        <article>
          <small>Diferença para a mediana</small>
          <strong className={analytics.currentPosition === "above" ? "negative" : "positive"}>
            {analytics.currentDifference === null
              ? "Indisponível"
              : <Money value={Math.abs(analytics.currentDifference)} />}
          </strong>
        </article>
        <article>
          <small>Meses considerados</small>
          <strong>{analytics.months.length}</strong>
          <span>Até 12 meses fechados</span>
        </article>
      </div>

      {analytics.months.length ? (
        <div
          className="invoice-consumption-chart"
          role="img"
          aria-label="Gráfico dos totais mensais das faturas fechadas e da fatura vigente"
        >
          {points.map(point => (
            <div className={point.current ? "current" : ""} key={point.key}>
              <span
                style={{
                  "--invoice-bar-height": `${Math.max(
                    5,
                    (point.total / maximum) * 100,
                  )}%`,
                } as CSSProperties}
                title={`${point.label}: ${point.total.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}`}
              />
              <small>{point.label}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="invoice-consumption-empty">
          As faturas oficiais fechadas serão adicionadas automaticamente nas
          próximas sincronizações.
        </p>
      )}
    </section>
  );
}
