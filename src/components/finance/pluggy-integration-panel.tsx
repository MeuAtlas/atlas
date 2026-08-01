"use client";

import { useActionState, useMemo, useState } from "react";
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
import {
  AtlasModal,
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import type {
  AutomaticSyncSummary,
  FinanceConnectionHealth,
  FinanceIntegrationDashboard,
  IntegrationAttentionItem,
  IntegrationProductSummary,
  RecentSyncActivity,
} from "@/modules/finance/integrations-dashboard";

const initial: IntegrationActionState = { status: "idle", message: "" };

type ModalState =
  | { type: "product"; product: IntegrationProductSummary }
  | { type: "run"; run: RecentSyncActivity }
  | { type: "history" }
  | { type: "automatic" }
  | { type: "unlink" }
  | { type: "full-sync" }
  | { type: "connect" }
  | null;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});
const timeFormatter = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatDate(value: string | null) {
  if (!value) return "Ainda não disponível";
  const date = new Date(value);
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const current = day.format(now);
  const target = day.format(date);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (target === current) return `Hoje, ${timeFormatter.format(date)}`;
  if (target === day.format(yesterday)) return `Ontem, ${timeFormatter.format(date)}`;
  return dateFormatter.format(date);
}

function formatDuration(milliseconds: number | null) {
  if (milliseconds === null) return "Em andamento";
  if (milliseconds < 60_000) return `${Math.max(1, Math.round(milliseconds / 1000))}s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1000);
  return `${minutes}min${seconds ? ` ${seconds}s` : ""}`;
}

function syncStatus(status: string) {
  if (status === "completed") return "Atualização concluída";
  if (["completed_with_warnings", "warning"].includes(status)) return "Atualização parcial";
  if (status === "running") return "Atualizando agora";
  if (status === "failed") return "Não foi possível atualizar";
  return "Aguardando atualização";
}

function triggerLabel(trigger: string) {
  if (trigger === "scheduled") return "Automática";
  if (trigger === "webhook") return "Atualização da instituição";
  if (trigger === "full_resync") return "Ressincronização completa";
  if (trigger === "retry") return "Nova tentativa";
  return "Manual";
}

function productStatus(status: IntegrationProductSummary["status"]) {
  return {
    updated: "Atualizado",
    partial: "Atualizado parcialmente",
    preserved: "Preservado",
    unavailable: "Indisponível",
    authentication_required: "Requer autenticação",
  }[status];
}

function Feedback({ state }: { state: IntegrationActionState }) {
  return state.message ? (
    <p className={`integration-feedback ${state.status}`} role="status">
      {state.message}
    </p>
  ) : null;
}

function SyncAction({ connectionId, compact = false }: { connectionId: string; compact?: boolean }) {
  const [state, action, pending] = useActionState(syncItemAction, initial);
  return (
    <form action={action} className="integrations-inline-action">
      <input type="hidden" name="connection_id" value={connectionId} />
      <button className={compact ? "integrations-button compact" : "integrations-button"} disabled={pending}>
        {pending ? "Sincronizando…" : "Sincronizar agora"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ConnectionHealthBadge({ health }: { health: FinanceConnectionHealth }) {
  return (
    <span className={`connection-health-badge ${health.severity}`}>
      <i aria-hidden="true" />
      {health.title}
    </span>
  );
}

export function IntegrationsPageHeader({
  dashboard,
}: {
  dashboard: FinanceIntegrationDashboard;
}) {
  return (
    <header className="integrations-page-header">
      <div>
        <p className="eyebrow">{dashboard.header.eyebrow}</p>
        <h1>{dashboard.header.title}</h1>
        <p>{dashboard.header.subtitle}</p>
      </div>
      {dashboard.primaryConnection ? (
        <SyncAction connectionId={dashboard.primaryConnection.id} />
      ) : null}
    </header>
  );
}

export function IntegrationSummaryMetrics({
  connection,
}: {
  connection: NonNullable<FinanceIntegrationDashboard["primaryConnection"]>;
}) {
  const products = [
    connection.accountCount ? `${connection.accountCount} conta` : null,
    connection.cardCount ? `${connection.cardCount} ${connection.cardCount === 1 ? "cartão" : "cartões"}` : null,
    connection.investmentCount ? "investimentos" : null,
    connection.loanCount ? "empréstimos" : null,
  ].filter(Boolean);
  return (
    <div className="integration-summary-metrics" aria-label="Resumo dos produtos">
      {products.length ? products.map(item => <span key={item}>{item}</span>) : <span>Produtos em identificação</span>}
    </div>
  );
}

export function PrimaryConnectionCard({
  dashboard,
  onOpen,
}: {
  dashboard: FinanceIntegrationDashboard;
  onOpen: (modal: Exclude<ModalState, null>) => void;
}) {
  const connection = dashboard.primaryConnection;
  if (!connection) return <IntegrationsEmptyState onConnect={() => onOpen({ type: "connect" })} />;
  return (
    <section className="primary-connection-card">
      <div className="primary-connection-topline">
        <div>
          <p>{connection.name === connection.provider ? "Conexão financeira" : connection.name}</p>
          <h2>{connection.provider}</h2>
        </div>
        <ConnectionHealthBadge health={connection.health} />
        <div className="primary-connection-actions">
          <SyncAction connectionId={connection.id} compact />
          <details className="integration-more-menu">
            <summary aria-label="Mais ações">•••</summary>
            <div>
              <button type="button" onClick={() => onOpen({ type: "full-sync" })}>Ressincronizar tudo</button>
              <button type="button" onClick={() => onOpen({ type: "history" })}>Ver histórico completo</button>
              <a href="#configuracoes-avancadas">Configurações avançadas</a>
              <button className="danger" type="button" onClick={() => onOpen({ type: "unlink" })}>Desvincular</button>
            </div>
          </details>
        </div>
      </div>
      <div className="primary-connection-dates">
        <span><small>Última atualização</small><b>{formatDate(connection.lastUpdateAt)}</b></span>
        <span><small>Última atualização integral</small><b>{formatDate(connection.lastFullSyncAt)}</b></span>
        <span><small>Próxima sincronização</small><b>{formatDate(connection.nextScheduledSyncAt)}</b></span>
      </div>
      <IntegrationSummaryMetrics connection={connection} />
      {connection.partialMessage ? (
        <button className="integration-health-message" type="button" onClick={() => onOpen({ type: "run", run: dashboard.recentActivity[0] })} disabled={!dashboard.recentActivity[0]}>
          <span><b>Atualização parcial</b>{connection.partialMessage}</span>
          <strong>Ver detalhes</strong>
        </button>
      ) : (
        <p className="integration-health-ok">{connection.health.description}</p>
      )}
    </section>
  );
}

export function SyncedProductRow({
  product,
  onOpen,
}: {
  product: IntegrationProductSummary;
  onOpen: () => void;
}) {
  return (
    <button className="synced-product-row" type="button" onClick={onOpen}>
      <span className={`product-state-dot ${product.status}`} aria-hidden="true" />
      <span><b>{product.name}</b><small>{product.type}</small></span>
      <span><b>{productStatus(product.status)}</b><small>Último sucesso {formatDate(product.lastSuccessfulSyncAt)}</small></span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

export function SyncedProductsPanel({
  products,
  onProduct,
}: {
  products: IntegrationProductSummary[];
  onProduct: (product: IntegrationProductSummary) => void;
}) {
  return (
    <section className="integrations-section synced-products-panel">
      <header><div><p className="eyebrow">COBERTURA</p><h2>Produtos sincronizados</h2></div><span>{products.length}</span></header>
      {products.length ? (
        <div>{products.map(product => <SyncedProductRow key={product.id} product={product} onOpen={() => onProduct(product)} />)}</div>
      ) : <p className="integrations-empty-line">A conexão ainda não retornou produtos financeiros.</p>}
    </section>
  );
}

export function AutomaticSyncBar({
  automatic,
  onConfigure,
}: {
  automatic: AutomaticSyncSummary | null;
  onConfigure: () => void;
}) {
  if (!automatic) return null;
  return (
    <section className="integrations-section automatic-sync-bar">
      <header><div><p className="eyebrow">ROTINA</p><h2>Sincronização automática</h2></div><span className={automatic.enabled ? "enabled" : ""}>{automatic.enabled ? "Ativada" : "Desativada"}</span></header>
      <p>Todos os dias, por volta das 23h — horário de Brasília.</p>
      <dl>
        <div><dt>Próxima execução</dt><dd>{formatDate(automatic.nextScheduledSyncAt)}</dd></div>
        <div><dt>Última execução</dt><dd>{automatic.lastRunAt ? formatDate(automatic.lastRunAt) : "Ainda não realizada"}</dd></div>
        <div><dt>Resultado</dt><dd>{automatic.lastRunStatus ? syncStatus(automatic.lastRunStatus) : "Aguardando"}</dd></div>
      </dl>
      <button type="button" className="integrations-text-button" onClick={onConfigure}>Configurar</button>
    </section>
  );
}

export function IntegrationAttentionPanel({
  items,
  onAction,
}: {
  items: IntegrationAttentionItem[];
  onAction: (item: IntegrationAttentionItem) => void;
}) {
  return (
    <section className="integration-attention-panel">
      <header><h2>Atenção necessária</h2></header>
      {items.length ? items.map(item => (
        <article className={item.severity} key={item.id}>
          <i aria-hidden="true">!</i><span><b>{item.title}</b><small>{item.description}</small></span>
          <button type="button" onClick={() => onAction(item)}>{item.actionLabel}</button>
        </article>
      )) : <p className="integrations-all-good"><i aria-hidden="true">✓</i>Tudo funcionando normalmente.</p>}
    </section>
  );
}

function SyncActivityRow({ run, onOpen }: { run: RecentSyncActivity; onOpen: () => void }) {
  return (
    <button className="sync-activity-row" type="button" onClick={onOpen}>
      <time>{formatDate(run.startedAt)}</time>
      <span><b>{syncStatus(run.status)}</b><small>{run.recordsInserted} novos · {run.recordsUpdated.toLocaleString("pt-BR")} atualizados</small></span>
      <span><b>{formatDuration(run.durationMs)}</b><small>{triggerLabel(run.triggerType)}</small></span>
      <i aria-hidden="true">›</i>
    </button>
  );
}

export function RecentSyncActivityPanel({
  runs,
  onRun,
  onHistory,
}: {
  runs: RecentSyncActivity[];
  onRun: (run: RecentSyncActivity) => void;
  onHistory: () => void;
}) {
  return (
    <section className="integrations-section recent-sync-panel">
      <header><div><p className="eyebrow">ATIVIDADE</p><h2>Atividade recente</h2></div>{runs.length ? <button type="button" onClick={onHistory}>Ver histórico completo</button> : null}</header>
      {runs.length ? <div>{runs.slice(0, 3).map(run => <SyncActivityRow key={run.id} run={run} onOpen={() => onRun(run)} />)}</div> : <p className="integrations-empty-line">Nenhuma sincronização registrada ainda.</p>}
    </section>
  );
}

function CredentialTest() {
  const [state, action, pending] = useActionState(testCredentialsAction, initial);
  return (
    <form action={action} className="advanced-action-row">
      <span><b>Credenciais da aplicação</b><small>Valida apenas a autenticação, sem sincronizar dados.</small></span>
      <button type="submit" disabled={pending}>{pending ? "Testando…" : "Testar credenciais"}</button>
      <Feedback state={state} />
    </form>
  );
}

function ManualItemForm() {
  const [state, action, pending] = useActionState(linkItemAction, initial);
  return (
    <form action={action} className="manual-item-form">
      <label><span>Item ID</span><input name="item_id" required maxLength={180} autoComplete="off" placeholder="ID fornecido pelo suporte Pluggy" /></label>
      <button type="submit" disabled={pending}>{pending ? "Validando…" : "Validar e vincular"}</button>
      <Feedback state={state} />
    </form>
  );
}

export function AdvancedIntegrationSettings({ dashboard }: { dashboard: FinanceIntegrationDashboard }) {
  const advanced = dashboard.advancedDiagnostics;
  return (
    <details className="advanced-integration-settings" id="configuracoes-avancadas">
      <summary><span><b>Configurações avançadas</b><small>Diagnóstico, suporte e operações especiais</small></span><i aria-hidden="true">⌄</i></summary>
      <div>
        <p className="advanced-warning">Use estas opções apenas para diagnóstico ou suporte.</p>
        <CredentialTest />
        {dashboard.primaryConnection ? (
          <details className="advanced-subsection">
            <summary>Vínculo manual por Item ID</summary>
            <p>Item atual: {advanced.maskedItem}. Use outro identificador somente com orientação do suporte.</p>
            <ManualItemForm />
          </details>
        ) : null}
        <section className="advanced-diagnostics">
          <header><h3>Diagnóstico de cartões</h3><span>{advanced.pendingInstruments ? `${advanced.pendingInstruments} pendentes` : "Sem pendências"}</span></header>
          <dl>
            <div><dt>Contas de crédito importadas</dt><dd>{advanced.creditAccounts}</dd></div>
            <div><dt>Instrumentos identificados</dt><dd>{advanced.instruments}</dd></div>
            <div><dt>Aguardando identificação</dt><dd>{advanced.pendingInstruments}</dd></div>
          </dl>
          {advanced.cardDiagnostics.length ? (
            <details className="advanced-subsection"><summary>Diagnóstico técnico por cartão</summary><div className="advanced-card-list">{advanced.cardDiagnostics.map(item => <p key={item.id}><b>{item.name} · {item.lastFour}</b><span>{item.received} recebidas · {item.persisted} persistidas · {item.included} incluídas · {item.excluded} excluídas</span></p>)}</div></details>
          ) : null}
        </section>
        <p className="advanced-safe-item">A conexão armazena somente identificadores seguros. Segredos da aplicação nunca são exibidos.</p>
      </div>
    </details>
  );
}

export function IntegrationsEmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <section className="integrations-empty-state">
      <span aria-hidden="true">↗</span>
      <div><p className="eyebrow">MEUPLUGGY</p><h2>Nenhuma conexão financeira</h2><p>Conecte o MeuPluggy para importar contas, cartões e movimentações.</p></div>
      <button className="integrations-button" type="button" onClick={onConnect}>Conectar MeuPluggy</button>
      <details><summary>Vincular Item manualmente</summary><ManualItemForm /></details>
    </section>
  );
}

export function ProductSyncDetailsModal({
  product,
  onClose,
}: {
  product: IntegrationProductSummary;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(retryResourceAction, initial);
  return (
    <AtlasModal open onClose={onClose} title="Detalhes do recurso" size="medium">
      <AtlasModalHeader><div><p className="eyebrow">DETALHES DO RECURSO</p><h2>{product.name}</h2><p>{product.type}</p></div><AtlasModalClose /></AtlasModalHeader>
      <AtlasModalBody className="integration-modal-body">
        <ConnectionHealthBadge health={{ overallStatus: product.status === "updated" ? "updated" : "partial", title: productStatus(product.status), description: "", severity: product.status === "updated" ? "success" : product.status === "authentication_required" ? "danger" : "warning", lastSuccessfulSyncAt: product.lastSuccessfulSyncAt, lastFullSyncAt: null, nextScheduledSyncAt: null, requiresAction: product.requiresAction, actionLabel: null, actionHref: null }} />
        <dl className="integration-detail-grid">
          <div><dt>Última tentativa</dt><dd>{formatDate(product.lastAttemptAt)}</dd></div>
          <div><dt>Último sucesso</dt><dd>{formatDate(product.lastSuccessfulSyncAt)}</dd></div>
          <div><dt>Dados recebidos</dt><dd>{product.recordsReceived.toLocaleString("pt-BR")}</dd></div>
          <div><dt>Novos</dt><dd>{product.recordsInserted.toLocaleString("pt-BR")}</dd></div>
          <div><dt>Atualizados</dt><dd>{product.recordsUpdated.toLocaleString("pt-BR")}</dd></div>
          <div><dt>Preservados</dt><dd>{product.recordsPreserved.toLocaleString("pt-BR")}</dd></div>
        </dl>
        {product.safeMessage ? <p className="integration-safe-message">{product.safeMessage}</p> : null}
        {product.requiresAction ? <form action={action}><input type="hidden" name="connection_id" value={product.connectionId} /><input type="hidden" name="resource_type" value={product.resourceType} /><button className="integrations-button" disabled={pending}>{pending ? "Tentando…" : "Tentar novamente"}</button><Feedback state={state} /></form> : null}
      </AtlasModalBody>
    </AtlasModal>
  );
}

export function SyncRunDetailsModal({ run, onClose }: { run: RecentSyncActivity; onClose: () => void }) {
  return (
    <AtlasModal open onClose={onClose} title="Detalhes da sincronização" size="medium">
      <AtlasModalHeader><div><p className="eyebrow">SINCRONIZAÇÃO</p><h2>Detalhes da sincronização</h2><p>{formatDate(run.startedAt)}</p></div><AtlasModalClose /></AtlasModalHeader>
      <AtlasModalBody className="integration-modal-body">
        <h3>{syncStatus(run.status)}</h3>
        <dl className="integration-detail-grid">
          <div><dt>Início</dt><dd>{formatDate(run.startedAt)}</dd></div>
          <div><dt>Fim</dt><dd>{formatDate(run.completedAt)}</dd></div>
          <div><dt>Duração</dt><dd>{formatDuration(run.durationMs)}</dd></div>
          <div><dt>Origem</dt><dd>{triggerLabel(run.triggerType)}</dd></div>
          <div><dt>Recursos atualizados</dt><dd>{run.resourcesSucceeded}</dd></div>
          <div><dt>Preservados</dt><dd>{run.resourcesPreserved}</dd></div>
          <div><dt>Indisponíveis</dt><dd>{run.resourcesFailed}</dd></div>
          <div><dt>Registros novos</dt><dd>{run.recordsInserted.toLocaleString("pt-BR")}</dd></div>
          <div><dt>Atualizados</dt><dd>{run.recordsUpdated.toLocaleString("pt-BR")}</dd></div>
        </dl>
        {run.warningCodes.length ? <p className="integration-safe-message">Alguns recursos permaneceram com o último estado confiável.</p> : null}
      </AtlasModalBody>
    </AtlasModal>
  );
}

export function FullSyncHistoryModal({
  runs,
  onClose,
  onRun,
}: {
  runs: RecentSyncActivity[];
  onClose: () => void;
  onRun: (run: RecentSyncActivity) => void;
}) {
  const [status, setStatus] = useState("all");
  const [trigger, setTrigger] = useState("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => runs.filter(run =>
    (status === "all" || run.status === status) &&
    (trigger === "all" || run.triggerType === trigger),
  ), [runs, status, trigger]);
  const pageSize = 5;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <AtlasModal open onClose={onClose} title="Histórico completo" size="large">
      <AtlasModalHeader><div><p className="eyebrow">ATIVIDADE</p><h2>Histórico de sincronização</h2><p>Execuções recentes da conexão financeira.</p></div><AtlasModalClose /></AtlasModalHeader>
      <AtlasModalBody className="integration-modal-body">
        <div className="history-filters">
          <label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="completed">Concluídas</option><option value="completed_with_warnings">Parciais</option><option value="failed">Falhas</option></select></label>
          <label>Tipo<select value={trigger} onChange={event => { setTrigger(event.target.value); setPage(1); }}><option value="all">Todos</option><option value="scheduled">Automática</option><option value="manual">Manual</option><option value="full_resync">Completa</option><option value="webhook">Instituição</option></select></label>
        </div>
        <div className="history-modal-list">{visible.length ? visible.map(run => <SyncActivityRow key={run.id} run={run} onOpen={() => onRun(run)} />) : <p className="integrations-empty-line">Nenhuma execução com estes filtros.</p>}</div>
        <nav className="history-pagination" aria-label="Paginação do histórico"><button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>{page} de {pages}</span><button type="button" disabled={page === pages} onClick={() => setPage(value => value + 1)}>Próxima</button></nav>
      </AtlasModalBody>
    </AtlasModal>
  );
}

export function AutomaticSyncModal({
  automatic,
  connectionId,
  onClose,
}: {
  automatic: AutomaticSyncSummary;
  connectionId: string;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(automatic.enabled);
  const [state, action, pending] = useActionState(toggleAutomaticSyncAction, initial);
  return (
    <AtlasModal open onClose={onClose} title="Sincronização automática" size="medium">
      <form action={action}>
        <input type="hidden" name="connection_id" value={connectionId} /><input type="hidden" name="enabled" value={String(enabled)} />
        <AtlasModalHeader><div><p className="eyebrow">ROTINA</p><h2>Sincronização automática</h2><p>Controle a atualização diária dos seus dados.</p></div><AtlasModalClose /></AtlasModalHeader>
        <AtlasModalBody className="integration-modal-body">
          <label className="automatic-modal-toggle"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /><span><b>Ativar sincronização automática</b><small>O Atlas tentará atualizar os dados diariamente.</small></span></label>
          <dl className="integration-detail-grid"><div><dt>Frequência</dt><dd>Todos os dias</dd></div><div><dt>Horário</dt><dd>23:00</dd></div><div><dt>Fuso horário</dt><dd>Brasília</dd></div><div><dt>Próxima execução</dt><dd>{enabled ? formatDate(automatic.nextScheduledSyncAt) : "Desativada"}</dd></div><div><dt>Última execução</dt><dd>{formatDate(automatic.lastRunAt)}</dd></div><div><dt>Resultado</dt><dd>{automatic.lastRunStatus ? syncStatus(automatic.lastRunStatus) : "Ainda não realizada"}</dd></div></dl>
          <p className="integration-safe-message">O horário é aproximado e pode variar dentro da janela programada conforme a disponibilidade do ambiente de execução.</p>
          <Feedback state={state} />
        </AtlasModalBody>
        <AtlasModalFooter><button type="button" onClick={onClose}>Cancelar</button><button className="integrations-button" disabled={pending || !automatic.available}>{pending ? "Salvando…" : "Salvar"}</button></AtlasModalFooter>
      </form>
    </AtlasModal>
  );
}

function ConfirmationModal({
  type,
  connectionId,
  onClose,
}: {
  type: "unlink" | "full-sync";
  connectionId: string;
  onClose: () => void;
}) {
  const action = type === "unlink" ? unlinkItemAction : fullSyncItemAction;
  const [state, formAction, pending] = useActionState(action, initial);
  const unlink = type === "unlink";
  return (
    <AtlasModal open onClose={onClose} title={unlink ? "Desvincular conexão" : "Ressincronizar tudo"} size="small" closeOnBackdrop={!pending}>
      <form action={formAction}>
        <input type="hidden" name="connection_id" value={connectionId} />
        <AtlasModalHeader><div><p className="eyebrow">CONFIRMAÇÃO</p><h2>{unlink ? "Desvincular MeuPluggy?" : "Ressincronizar todos os produtos?"}</h2></div><AtlasModalClose disabled={pending} /></AtlasModalHeader>
        <AtlasModalBody className="integration-modal-body"><p>{unlink ? "Novas sincronizações serão bloqueadas. Os dados já importados serão preservados e não serão apagados." : "A atualização completa pode levar mais tempo. Personalizações e dados existentes não serão apagados antes da nova leitura."}</p><Feedback state={state} /></AtlasModalBody>
        <AtlasModalFooter><button type="button" onClick={onClose} disabled={pending}>Cancelar</button><button className={unlink ? "integrations-danger-button" : "integrations-button"} disabled={pending}>{pending ? "Processando…" : unlink ? "Desvincular" : "Continuar"}</button></AtlasModalFooter>
      </form>
    </AtlasModal>
  );
}

function ConnectModal({ configured, onClose }: { configured: boolean; onClose: () => void }) {
  return (
    <AtlasModal open onClose={onClose} title="Conectar MeuPluggy" size="medium">
      <AtlasModalHeader><div><p className="eyebrow">NOVA CONEXÃO</p><h2>Conectar MeuPluggy</h2><p>Importe suas contas e produtos financeiros.</p></div><AtlasModalClose /></AtlasModalHeader>
      <AtlasModalBody className="integration-modal-body">
        <p>{configured ? "O fluxo assistido ainda não está disponível nesta instalação. Use o Item ID fornecido pelo painel ou pelo suporte Pluggy." : "A integração ainda não possui credenciais válidas. Configure a aplicação antes de vincular uma instituição."}</p>
        {configured ? <ManualItemForm /> : null}
      </AtlasModalBody>
    </AtlasModal>
  );
}

export function FinanceIntegrationsDashboard({ dashboard }: { dashboard: FinanceIntegrationDashboard }) {
  const [modal, setModal] = useState<ModalState>(null);
  const connection = dashboard.primaryConnection;
  const attentionAction = (item: IntegrationAttentionItem) => {
    if (item.target === "automatic") setModal({ type: "automatic" });
    if (item.target === "product") {
      const product = dashboard.products.find(candidate => candidate.id === item.targetId);
      if (product) setModal({ type: "product", product });
    }
    if (item.target === "advanced") {
      const advancedSettings = document.getElementById(
        "configuracoes-avancadas",
      ) as HTMLDetailsElement | null;
      if (advancedSettings) {
        advancedSettings.open = true;
        advancedSettings.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };
  return (
    <div className="integrations-dashboard">
      <IntegrationsPageHeader dashboard={dashboard} />
      <PrimaryConnectionCard dashboard={dashboard} onOpen={setModal} />
      {connection ? <div className="integrations-two-column"><SyncedProductsPanel products={dashboard.products} onProduct={product => setModal({ type: "product", product })} /><AutomaticSyncBar automatic={dashboard.automaticSync} onConfigure={() => setModal({ type: "automatic" })} /></div> : null}
      {connection ? <IntegrationAttentionPanel items={dashboard.attentionItems} onAction={attentionAction} /> : null}
      {connection ? <RecentSyncActivityPanel runs={dashboard.recentActivity} onRun={run => setModal({ type: "run", run })} onHistory={() => setModal({ type: "history" })} /> : null}
      <AdvancedIntegrationSettings dashboard={dashboard} />

      {modal?.type === "product" ? <ProductSyncDetailsModal product={modal.product} onClose={() => setModal(null)} /> : null}
      {modal?.type === "run" ? <SyncRunDetailsModal run={modal.run} onClose={() => setModal(null)} /> : null}
      {modal?.type === "history" ? <FullSyncHistoryModal runs={dashboard.syncHistory} onClose={() => setModal(null)} onRun={run => setModal({ type: "run", run })} /> : null}
      {modal?.type === "automatic" && dashboard.automaticSync && connection ? <AutomaticSyncModal automatic={dashboard.automaticSync} connectionId={connection.id} onClose={() => setModal(null)} /> : null}
      {(modal?.type === "unlink" || modal?.type === "full-sync") && connection ? <ConfirmationModal type={modal.type} connectionId={connection.id} onClose={() => setModal(null)} /> : null}
      {modal?.type === "connect" ? <ConnectModal configured={dashboard.advancedDiagnostics.configured} onClose={() => setModal(null)} /> : null}
    </div>
  );
}
