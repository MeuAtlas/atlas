"use client";

import { useActionState } from "react";
import {
  fullSyncItemAction,
  linkItemAction,
  retryResourceAction,
  syncItemAction,
  testCredentialsAction,
  toggleAutomaticSyncAction,
  unlinkItemAction,
  type IntegrationActionState,
} from "@/app/financeiro/integracoes/actions";

type Connection = {
  id: string;
  connector_name: string | null;
  status: string;
  sync_status: string;
  automatic_sync_enabled: boolean;
  last_provider_update_at: string | null;
  last_successful_sync_at: string | null;
  last_complete_sync_at: string | null;
  last_sync_at: string | null;
  provider_status: string;
  data_completeness: string;
  incident_message: string | null;
  stale_since: string | null;
  partial_data_count: number;
  connection_error_message: string | null;
  maskedItem: string;
  diagnostics: {
    creditAccounts: number;
    instruments: number;
    pending: number;
  };
  resourceStatuses: ResourceSyncStatus[];
};

type ResourceSyncStatus = {
  id: string;
  syncRunId: string;
  resourceType: string;
  entityType: string | null;
  providerEntityId: string;
  status: string;
  dataFreshness: string;
  lastAttemptAt: string;
  lastSuccessfulSyncAt: string | null;
  received: number;
  inserted: number;
  updated: number;
  unchanged: number;
  preserved: number;
  errorCode: string | null;
  warningCodes: string[];
  retryable: boolean;
  nextRetryAt: string | null;
  metadata: Record<string, unknown>;
};

type SyncRun = {
  id: string;
  bank_connection_id: string;
  status: string;
  trigger_type: string;
  started_at: string;
  completed_at: string | null;
  accounts_count: number;
  cards_count: number;
  transactions_count: number;
  investments_count: number;
  loans_count: number;
  resources_succeeded: number;
  resources_failed: number;
  resources_preserved: number;
  records_inserted: number;
  records_updated: number;
  records_preserved: number;
  warning_codes: string[];
};

type CardSyncDiagnostic = {
  id: string;
  cardId: string;
  name: string;
  lastFour: string;
  received: number;
  mapped: number;
  persisted: number;
  included: number;
  excluded: number;
  pages: number;
  pageSizes: number[];
  statusCounts: Record<string, number>;
  classificationCounts: Record<string, number>;
  referenceCounts: Record<string, number>;
  instrumentCounts: Record<string, number>;
  exclusionCounts: Record<string, number>;
  createdAt: string;
};

type SectionWarnings = {
  providerHealth: boolean;
  history: boolean;
  instruments: boolean;
  cardDiagnostics: boolean;
  resourceHistory: boolean;
  automaticSync: boolean;
};

const initial: IntegrationActionState = { status: "idle", message: "" };

function Feedback({ state }: { state: IntegrationActionState }) {
  return state.message ? (
    <p className={`integration-feedback ${state.status}`} role="status">
      {state.message}
    </p>
  ) : null;
}

function SectionWarning({ children }: { children: React.ReactNode }) {
  return (
    <p className="integration-section-warning" role="status">
      {children}
    </p>
  );
}

function ActionForm({
  action,
  id,
  label,
  danger = false,
  confirmMessage,
  resourceType,
}: {
  action: typeof syncItemAction;
  id: string;
  label: string;
  danger?: boolean;
  confirmMessage?: string;
  resourceType?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="connection_id" value={id} />
      {resourceType ? (
        <input type="hidden" name="resource_type" value={resourceType} />
      ) : null}
      <button
        className={danger ? "integration-action danger" : "integration-action"}
        disabled={pending}
      >
        {pending ? "Processando…" : label}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function AutomaticSyncForm({
  connectionId,
  enabled,
  available,
}: {
  connectionId: string;
  enabled: boolean;
  available: boolean;
}) {
  const [state, action, pending] = useActionState(
    toggleAutomaticSyncAction,
    initial,
  );
  return (
    <form action={action} className="integration-automatic-toggle">
      <input type="hidden" name="connection_id" value={connectionId} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        className={enabled ? "integration-toggle enabled" : "integration-toggle"}
        disabled={pending || !available}
        aria-pressed={enabled}
      >
        <span aria-hidden="true" />
        {!available
          ? "Disponível após a migration 047"
          : pending
          ? "Salvando…"
          : enabled
            ? "Automática ativada"
            : "Ativar sincronização automática"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

const nextAutomaticExecution = () => {
  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      2,
    ),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return formatDateTime(next.toISOString());
};

const formatDuration = (startedAt: string, completedAt: string | null) => {
  if (!completedAt) return "em andamento";
  const duration = Math.max(
    0,
    new Date(completedAt).getTime() - new Date(startedAt).getTime(),
  );
  if (duration < 60_000) return `${Math.round(duration / 1000)}s`;
  return `${Math.floor(duration / 60_000)}min ${Math.round(
    (duration % 60_000) / 1000,
  )}s`;
};

const syncStatusLabel = (status: string) =>
  status === "completed"
    ? "Concluída"
    : status === "completed_with_warnings" || status === "warning"
      ? "Parcialmente concluída"
      : status === "running"
        ? "Em andamento"
        : status === "failed"
          ? "Falhou"
          : "Aguardando";

const resourceLabel = (resource: string) =>
  ({
    accounts: "Conta corrente",
    transactions: "Movimentações",
    credit_cards: "Cartões",
    bills: "Faturas",
    loans: "Empréstimos",
    investments: "Investimentos",
    identity: "Titularidade",
    item: "Conexão Pluggy",
    connector: "Instituição",
  })[resource] ?? resource;

const resourceStatusLabel = (resource: ResourceSyncStatus) => {
  if (resource.status === "succeeded") return "Atualizado";
  if (resource.status === "succeeded_with_warnings") return "Atualizado parcialmente";
  if (resource.status === "preserved") return "Dados preservados";
  if (resource.status === "unavailable") return "Temporariamente indisponível";
  if (resource.status === "failed") return "Não foi possível atualizar";
  if (resource.status === "skipped") return "Não processado";
  return resource.status;
};

const resourceName = (resource: ResourceSyncStatus) => {
  const name = resource.metadata.name;
  if (typeof name === "string" && name.trim()) return name;
  return resourceLabel(resource.resourceType);
};

export function PluggyIntegrationPanel({
  configured,
  connections,
  runs,
  cardDiagnostics,
  warnings,
}: {
  configured: boolean;
  connections: Connection[];
  runs: SyncRun[];
  cardDiagnostics: CardSyncDiagnostic[];
  warnings: SectionWarnings;
}) {
  const [testState, testAction, testPending] = useActionState(
    testCredentialsAction,
    initial,
  );
  const [linkState, linkAction, linkPending] = useActionState(
    linkItemAction,
    initial,
  );

  return (
    <div className="integration-grid">
      <section className="finance-panel integration-diagnostics">
        <header>
          <h2>Diagnóstico de cartões</h2>
        </header>
        {warnings.instruments ? (
          <SectionWarning>
            As métricas de cartões estão temporariamente indisponíveis.
          </SectionWarning>
        ) : (
          <div className="finance-list">
            <div>
              <span>
                <b>Contas de crédito importadas</b>
                <small>Produtos com limite e fatura</small>
              </span>
              <strong>
                {connections.reduce(
                  (total, item) =>
                    total + item.diagnostics.creditAccounts,
                  0,
                )}
              </strong>
            </div>
            <div>
              <span>
                <b>Instrumentos identificados</b>
                <small>Cartões físicos, virtuais, online ou adicionais</small>
              </span>
              <strong>
                {connections.reduce(
                  (total, item) => total + item.diagnostics.instruments,
                  0,
                )}
              </strong>
            </div>
            <div>
              <span>
                <b>Aguardando identificação</b>
                <small>
                  Compras sem identificador seguro do instrumento
                </small>
              </span>
              <strong>
                {connections.reduce(
                  (total, item) => total + item.diagnostics.pending,
                  0,
                )}
              </strong>
            </div>
          </div>
        )}
      </section>

      <section className="finance-panel integration-overview">
        <header>
          <div>
            <p className="eyebrow">Open Finance</p>
            <h2>Pluggy</h2>
          </div>
          <span className={`status ${configured ? "success" : "danger"}`}>
            {configured ? "Configurada" : "Não configurada"}
          </span>
        </header>
        <p>
          Importe contas, cartões, movimentações, investimentos e empréstimos
          sem armazenar senhas bancárias no Atlas.
        </p>
        <form action={testAction}>
          <button
            className="finance-button"
            disabled={!configured || testPending}
          >
            {testPending ? "Testando…" : "Testar credenciais"}
          </button>
          <Feedback state={testState} />
        </form>
      </section>

      <section className="finance-panel">
        <header>
          <div>
            <p className="eyebrow">Vincular conexão</p>
            <h2>Item da Pluggy</h2>
          </div>
        </header>
        <p>
          A Pluggy não oferece uma API para listar Items existentes. Copie o
          Item ID do painel da Pluggy; o Atlas o valida antes de vincular.
        </p>
        <form action={linkAction} className="integration-link-form">
          <label>
            Item ID
            <input
              name="item_id"
              autoComplete="off"
              required
              maxLength={180}
              placeholder="ID exibido no painel Pluggy"
            />
          </label>
          <button
            className="finance-button"
            disabled={!configured || linkPending}
          >
            {linkPending
              ? "Validando e sincronizando…"
              : "Validar e vincular"}
          </button>
          <Feedback state={linkState} />
        </form>
      </section>

      <section className="finance-panel integration-automatic">
        <header>
          <div>
            <p className="eyebrow">Rotina diária</p>
            <h2>Sincronização automática</h2>
          </div>
          <span
            className={`status ${
              warnings.automaticSync
                ? "danger"
                : connections.some(connection =>
                    connection.automatic_sync_enabled)
                  ? "success"
                  : ""
            }`}
          >
            {warnings.automaticSync
              ? "Configuração pendente"
              : connections.some(connection =>
                    connection.automatic_sync_enabled)
                ? "Agendada"
                : "Desativada"}
          </span>
        </header>
        <p>
          Todos os dias, por volta das 23h — horário de Brasília.
        </p>
        <div className="integration-automatic-summary">
          <span>
            <small>Próxima execução estimada</small>
            <b>{nextAutomaticExecution()}</b>
          </span>
          <span>
            <small>Precisão do agendamento</small>
            <b>Execução dentro da hora programada</b>
          </span>
        </div>
        {warnings.automaticSync ? (
          <SectionWarning>
            A preferência automática estará disponível após a migration 047.
          </SectionWarning>
        ) : null}
      </section>

      <section className="finance-panel integration-connections">
        <header>
          <h2>Conexões</h2>
          <span>{connections.length}</span>
        </header>
        {warnings.providerHealth ? (
          <SectionWarning>
            O status detalhado do provedor está temporariamente indisponível.
          </SectionWarning>
        ) : null}
        {warnings.resourceHistory ? (
          <SectionWarning>
            Os detalhes por recurso estarão disponíveis após a migration de
            sincronização incremental.
          </SectionWarning>
        ) : null}
        {connections.length ? (
          <div className="integration-list">
            {connections.map((connection) => {
              const last = runs.find(
                (run) => run.bank_connection_id === connection.id,
              );
              const lastAutomatic = runs.find(
                run =>
                  run.bank_connection_id === connection.id &&
                  run.trigger_type === "scheduled",
              );
              const latestResources = last
                ? connection.resourceStatuses.filter(
                    (resource) => resource.syncRunId === last.id,
                  )
                : [];
              const partial =
                last?.status === "completed_with_warnings" ||
                connection.sync_status === "completed_with_warnings" ||
                connection.sync_status === "warning";
              return (
                <article key={connection.id}>
                  <div>
                    <b>
                      {connection.connector_name || "Instituição conectada"}
                    </b>
                    <small>
                      Item {connection.maskedItem} ·{" "}
                      {syncStatusLabel(connection.sync_status)}
                    </small>
                    {partial ? (
                      <p className="integration-partial-summary">
                        Parte dos dados foi atualizada. Os recursos indisponíveis
                        permaneceram com o último estado confiável.
                      </p>
                    ) : null}
                    {connection.last_provider_update_at ? (
                      <small>
                        Provedor atualizado:{" "}
                        {formatDateTime(connection.last_provider_update_at)}
                      </small>
                    ) : null}
                    {connection.last_successful_sync_at ? (
                      <small>
                        Última atualização integral:{" "}
                        {formatDateTime(connection.last_successful_sync_at)}
                      </small>
                    ) : null}
                    {last ? (
                      <small>
                        {last.records_inserted} novos · {last.records_updated}{" "}
                        atualizados · {last.resources_preserved} recursos preservados
                      </small>
                    ) : null}
                    <div className="integration-automatic-status">
                      <div>
                        <small>Última execução automática</small>
                        <b>
                          {lastAutomatic
                            ? formatDateTime(lastAutomatic.started_at)
                            : "Ainda não executada"}
                        </b>
                      </div>
                      <div>
                        <small>Resultado</small>
                        <b>
                          {lastAutomatic
                            ? syncStatusLabel(lastAutomatic.status)
                            : "Aguardando"}
                        </b>
                      </div>
                      <div>
                        <small>Duração</small>
                        <b>
                          {lastAutomatic
                            ? formatDuration(
                                lastAutomatic.started_at,
                                lastAutomatic.completed_at,
                              )
                            : "—"}
                        </b>
                      </div>
                      <div>
                        <small>Recursos</small>
                        <b>
                          {lastAutomatic
                            ? `${lastAutomatic.resources_succeeded} atualizados · ${lastAutomatic.resources_preserved} preservados · ${lastAutomatic.resources_failed} falhos`
                            : "Sem histórico"}
                        </b>
                      </div>
                    </div>
                    {latestResources.length ? (
                      <ul className="integration-resource-summary">
                        {latestResources
                          .filter((resource) =>
                            [
                              "accounts",
                              "transactions",
                              "credit_cards",
                              "bills",
                              "loans",
                              "investments",
                            ].includes(resource.resourceType),
                          )
                          .slice(0, 6)
                          .map((resource) => (
                            <li key={resource.id}>
                              <span>{resourceName(resource)}</span>
                              <b>{resourceStatusLabel(resource)}</b>
                              {resource.inserted ? (
                                <small>{resource.inserted} novo(s)</small>
                              ) : resource.lastSuccessfulSyncAt ? (
                                <small>
                                  Último sucesso{" "}
                                  {formatDateTime(resource.lastSuccessfulSyncAt)}
                                </small>
                              ) : null}
                            </li>
                          ))}
                      </ul>
                    ) : null}
                    {latestResources.length ? (
                      <details className="integration-resource-details">
                        <summary>Detalhes da sincronização</summary>
                        <div>
                          {latestResources.map((resource) => (
                            <article key={resource.id}>
                              <span>
                                <b>{resourceName(resource)}</b>
                                <small>{resourceLabel(resource.resourceType)}</small>
                              </span>
                              <span>
                                <b>{resourceStatusLabel(resource)}</b>
                                <small>
                                  Tentativa {formatDateTime(resource.lastAttemptAt)}
                                </small>
                              </span>
                              <span>
                                <b>
                                  {resource.inserted} novos · {resource.updated}{" "}
                                  atualizados
                                </b>
                                <small>
                                  Freshness:{" "}
                                  {resource.dataFreshness === "current"
                                    ? "atual"
                                    : resource.dataFreshness === "stale"
                                      ? "desatualizado"
                                      : resource.dataFreshness ===
                                          "partially_current"
                                        ? "parcialmente atual"
                                        : "indisponível"}
                                </small>
                                {resource.retryable ? (
                                  <ActionForm
                                    action={retryResourceAction}
                                    id={connection.id}
                                    resourceType={resource.resourceType}
                                    label="Tentar este recurso"
                                  />
                                ) : null}
                              </span>
                            </article>
                          ))}
                        </div>
                      </details>
                    ) : null}
                    {connection.connection_error_message ? (
                      <p className="integration-error">
                        {connection.connection_error_message}
                      </p>
                    ) : null}
                  </div>
                  <div className="integration-actions">
                    <AutomaticSyncForm
                      connectionId={connection.id}
                      enabled={connection.automatic_sync_enabled}
                      available={!warnings.automaticSync}
                    />
                    <ActionForm
                      action={syncItemAction}
                      id={connection.id}
                      label="Sincronizar agora"
                    />
                    <ActionForm
                      action={fullSyncItemAction}
                      id={connection.id}
                      label="Ressincronizar tudo"
                      confirmMessage="Refazer a sincronização completa? O processo é idempotente e não apaga personalizações."
                    />
                    <ActionForm
                      action={unlinkItemAction}
                      id={connection.id}
                      label="Desvincular"
                      danger
                      confirmMessage="Desvincular este Item? Novas sincronizações serão bloqueadas, mas os dados já importados serão preservados."
                    />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="integration-empty">Nenhuma conexão ativa.</p>
        )}
      </section>

      {warnings.history ? (
        <section className="finance-panel integration-connections">
          <header>
            <h2>Histórico de sincronização</h2>
          </header>
          <SectionWarning>
            O histórico está temporariamente indisponível.
          </SectionWarning>
        </section>
      ) : runs.length ? (
        <section className="finance-panel integration-connections">
          <header>
            <h2>Histórico de sincronização</h2>
            <span>{runs.length}</span>
          </header>
          <div className="finance-list">
            {runs.slice(0, 10).map((run) => (
              <div key={run.id}>
                <span>
                  <b>{syncStatusLabel(run.status)}</b>
                  <small>{formatDateTime(run.started_at)}</small>
                  <small>
                    {run.trigger_type === "scheduled"
                      ? "Execução automática"
                      : run.trigger_type === "webhook"
                        ? "Webhook da Pluggy"
                        : "Execução manual"}
                    {" · "}
                    {formatDuration(run.started_at, run.completed_at)}
                  </small>
                  <small>
                    {run.resources_succeeded} atualizados ·{" "}
                    {run.resources_preserved} preservados ·{" "}
                    {run.resources_failed} indisponíveis
                  </small>
                </span>
                <strong>
                  {run.records_inserted} novos · {run.records_updated} alterados
                </strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {warnings.cardDiagnostics ? (
        <section className="finance-panel integration-connections">
          <header>
            <h2>Conciliação por conta CREDIT</h2>
          </header>
          <SectionWarning>
            Algumas informações de diagnóstico estão temporariamente
            indisponíveis.
          </SectionWarning>
        </section>
      ) : cardDiagnostics.length ? (
        <section className="finance-panel integration-connections">
          <header>
            <h2>Conciliação por conta CREDIT</h2>
            <span>{cardDiagnostics.length}</span>
          </header>
          <div className="finance-list">
            {cardDiagnostics.map((item) => (
              <details key={item.id}>
                <summary>
                  <b>
                    {item.name} · {item.lastFour}
                  </b>
                  <small>
                    {item.received} recebidas · {item.persisted} persistidas ·{" "}
                    {item.included} incluídas
                  </small>
                </summary>
                <div className="diagnostic-count-grid">
                  <span>
                    Páginas <b>{item.pages}</b>
                  </span>
                  <span>
                    Mapeadas <b>{item.mapped}</b>
                  </span>
                  <span>
                    Excluídas <b>{item.excluded}</b>
                  </span>
                  <span>
                    PENDING <b>{item.statusCounts.PENDING ?? 0}</b>
                  </span>
                  <span>
                    POSTED <b>{item.statusCounts.POSTED ?? 0}</b>
                  </span>
                  <span>
                    Sem billId <b>{item.referenceCounts.withoutBillId ?? 0}</b>
                  </span>
                  <span>
                    Com previsão{" "}
                    <b>{item.referenceCounts.withBillForecastDate ?? 0}</b>
                  </span>
                  <span>
                    Compras <b>{item.classificationCounts.consumption ?? 0}</b>
                  </span>
                  <span>
                    Parcelas <b>{item.classificationCounts.installment ?? 0}</b>
                  </span>
                  <span>
                    Estornos <b>{item.classificationCounts.refund ?? 0}</b>
                  </span>
                  <span>
                    Tarifas/ajustes{" "}
                    <b>{item.classificationCounts.adjustment ?? 0}</b>
                  </span>
                  <span>
                    Fora do ciclo{" "}
                    <b>{item.exclusionCounts.outside_cycle ?? 0}</b>
                  </span>
                  <span>
                    Pagamentos{" "}
                    <b>{item.exclusionCounts.invoice_payment ?? 0}</b>
                  </span>
                  <span>
                    Duplicadas <b>{item.exclusionCounts.duplicate ?? 0}</b>
                  </span>
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
