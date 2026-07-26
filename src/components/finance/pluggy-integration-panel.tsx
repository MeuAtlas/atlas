"use client";

import { useActionState } from "react";
import {
  fullSyncItemAction,
  linkItemAction,
  syncItemAction,
  testCredentialsAction,
  unlinkItemAction,
  type IntegrationActionState,
} from "@/app/financeiro/integracoes/actions";

type Connection = {
  id: string;
  connector_name: string | null;
  status: string;
  sync_status: string;
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
};

type SyncRun = {
  id: string;
  bank_connection_id: string;
  status: string;
  started_at: string;
  accounts_count: number;
  cards_count: number;
  transactions_count: number;
  investments_count: number;
  loans_count: number;
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
}: {
  action: typeof syncItemAction;
  id: string;
  label: string;
  danger?: boolean;
  confirmMessage?: string;
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

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));

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
        {connections.length ? (
          <div className="integration-list">
            {connections.map((connection) => {
              const last = runs.find(
                (run) => run.bank_connection_id === connection.id,
              );
              return (
                <article key={connection.id}>
                  <div>
                    <b>
                      {connection.connector_name || "Instituição conectada"}
                    </b>
                    <small>
                      Item {connection.maskedItem} · {connection.sync_status}
                    </small>
                    {connection.last_provider_update_at ? (
                      <small>
                        Provedor atualizado:{" "}
                        {formatDateTime(connection.last_provider_update_at)}
                      </small>
                    ) : null}
                    {connection.last_successful_sync_at ? (
                      <small>
                        Último sucesso no Atlas:{" "}
                        {formatDateTime(connection.last_successful_sync_at)}
                      </small>
                    ) : null}
                    {last ? (
                      <small>
                        {last.accounts_count} contas · {last.cards_count} cartões
                        · {last.transactions_count} movimentações ·{" "}
                        {last.investments_count} investimentos ·{" "}
                        {last.loans_count} empréstimos
                      </small>
                    ) : null}
                    {connection.connection_error_message ? (
                      <p className="integration-error">
                        {connection.connection_error_message}
                      </p>
                    ) : null}
                  </div>
                  <div className="integration-actions">
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
                  <b>{run.status}</b>
                  <small>{formatDateTime(run.started_at)}</small>
                </span>
                <strong>{run.transactions_count} movimentações</strong>
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
