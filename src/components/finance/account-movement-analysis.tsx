import { AccountMovementChart } from "./overview-charts";
import {
  BankAccountMovementCards,
  type BankMovementDetailsType,
} from "./bank-account-movement-cards";
import {
  Money,
  ValueVisibilityButton,
} from "./value-visibility";
import type { BankAccountMonthlyMovement } from "@/modules/finance/account-movement";
import { DismissibleAlert } from "@/components/atlas/dismissible-alert";
import { createProviderAlertIncidentId } from "@/components/atlas/dismissible-alert-state";

function resultTone(value: number) {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function resultMessage(value: number) {
  if (value > 0) return "Entrou mais dinheiro do que saiu desta conta.";
  if (value < 0) return "Saiu mais dinheiro do que entrou nesta conta.";
  return "As entradas e saídas ficaram equilibradas.";
}

export function AccountMovementAnalysis({
  movement,
  monthLabel,
  initialDetails,
}: {
  movement: BankAccountMonthlyMovement;
  monthLabel: string;
  initialDetails?: BankMovementDetailsType;
}) {
  const partial = movement.dataCompleteness !== "complete";
  const movementWarningId = createProviderAlertIncidentId({
    provider: movement.source,
    institution: movement.institutionName || movement.accountName,
    connectionId: movement.accountId,
    providerStatus: movement.dataCompleteness,
    dataCompleteness: movement.dataCompleteness,
    syncStatus: movement.dataCompleteness,
    incidentStartedAt: movement.lastSyncAt,
    providerStatusAt: movement.lastSyncAt,
    partialDataCount: movement.warnings.length,
    messageVersion: movement.warnings.join("|"),
  });

  return (
    <section className="account-analysis" aria-labelledby="account-analysis-title">
      <header className="account-analysis-heading">
        <div>
          <h2 id="account-analysis-title">Análise da movimentação</h2>
          <span aria-hidden="true">·</span>
          <p>{monthLabel}</p>
          <details className="overview-result-help">
            <summary
              aria-label="Como a análise da movimentação é calculada"
              title="Como a análise da movimentação é calculada"
            >
              ?
            </summary>
            <div className="overview-result-help-content">
              Esta análise considera apenas créditos e débitos efetivamente
              lançados na conta selecionada durante o mês.
            </div>
          </details>
        </div>
      </header>

      <div className="account-analysis-grid">
        <article className="overview-balance account-analysis-result">
          <header>
            <div className="account-movement-heading">
              <p>Resultado da movimentação</p>
              <small>Entradas menos saídas da conta no mês selecionado.</small>
            </div>
            <ValueVisibilityButton className="overview-hide-values" />
          </header>
          {movement.warnings.length ? (
            <DismissibleAlert
              id={movementWarningId}
              className="account-movement-warnings account-movement-dismissible"
              title="Dados bancários parcialmente disponíveis"
              message={movement.warnings.join(" ")}
              severity="warning"
            />
          ) : null}
          {movement.inflowCount + movement.outflowCount === 0 ? (
            <p className="account-movement-empty" role="status">
              Nenhuma movimentação encontrada para esta conta no mês
              selecionado.
            </p>
          ) : null}
          <div className="overview-balance-main">
            <dl className="account-movement-values">
              <div className={`net ${resultTone(movement.netMovement)}`}>
                <dt>Resultado do mês</dt>
                <dd>
                  <Money value={movement.netMovement} signed />
                </dd>
                <small className="account-movement-result-message">
                  {resultMessage(movement.netMovement)}
                </small>
              </div>
            </dl>
            <AccountMovementChart data={movement.dailySeries} />
          </div>
        </article>

        <BankAccountMovementCards
          movement={movement}
          initialDetails={initialDetails}
        />
      </div>

      <p className={`account-analysis-notice ${partial ? "warning" : ""}`}>
        {partial
          ? "Alguns dados podem estar incompletos devido ao status da conexão bancária."
          : "Os valores exibidos consideram apenas lançamentos já processados pelo banco."}
      </p>
    </section>
  );
}
