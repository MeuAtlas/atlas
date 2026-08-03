import { CardStatusForm } from "@/components/finance/card-status-form";
import {
  CreditCardViewTabs,
  type CreditCardPageView,
} from "@/components/finance/credit-card-view-tabs";
import { CurrentInvoiceCard } from "@/components/finance/current-invoice-card";
import { ImportInvoiceButton } from "@/components/finance/import-invoice-button";
import { EmptyState } from "@/components/finance/empty-state";
import { InvoiceHistorySection } from "@/components/finance/invoice-history-section";
import { InvoiceConsumptionAnalytics } from "@/components/finance/invoice-consumption-analytics";
import { SubmitButton } from "@/components/finance/submit-button";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import {
  archiveCard,
  archiveCardInstrument,
  restoreCard,
  restoreCardInstrument,
  updateCardDates,
  updateCardInstrument,
  updateCardInstrumentPaymentResponsibility,
} from "@/modules/finance/actions";
import { requireFinanceAccess } from "@/modules/finance/access";
import { buildCurrentCardInvoices } from "@/modules/finance/card-invoices";
import {
  HISTORICAL_INVOICE_STATUSES,
  buildInvoiceHistoryAnalytics,
  type InvoiceHistoryAnalyticsEntry,
  type CreditCardInvoiceHistoryResult,
  type HistoricalInvoiceStatus,
} from "@/modules/finance/invoice-history";
import {
  getCreditCardInvoiceHistory,
  getCreditCardInvoiceAnalyticsEntries,
  getFinanceData,
  getReliableCurrentInvoiceSnapshots,
  getResolvedCardCycleDetails,
  resolveOpenCardInvoice,
} from "@/modules/finance/queries";
import { syncCurrentInvoicesAction } from "@/app/financeiro/integracoes/actions";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const views: CreditCardPageView[] = [
  "current",
  "history",
  "manage",
  "archived",
];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    toast?: string;
    workspace?: string;
    card?: string;
    year?: string;
    status?: string;
    period?: string;
    cursor?: string;
    q?: string;
    sync?: string;
    invoice?: string;
  }>;
}) {
  const query = await searchParams;
  const view = views.includes(query.view as CreditCardPageView)
    ? (query.view as CreditCardPageView)
    : "current";
  const workspaceId =
    query.workspace && UUID.test(query.workspace) ? query.workspace : null;
  const year = /^\d{4}$/.test(query.year ?? "") ? Number(query.year) : undefined;
  const status = HISTORICAL_INVOICE_STATUSES.includes(
    query.status as HistoricalInvoiceStatus,
  )
    ? (query.status as HistoricalInvoiceStatus)
    : undefined;
  const period = ["3m", "6m", "12m"].includes(query.period ?? "")
    ? query.period
    : undefined;
  const periodStart = period
    ? (() => {
        const date = new Date();
        date.setUTCMonth(date.getUTCMonth() - Number(period.slice(0, -1)));
        return date.toISOString().slice(0, 10);
      })()
    : undefined;
  const { supabase, user } = await requireFinanceAccess();
  const [data,storedInvoices,peopleResult]=await Promise.all([
    getFinanceData(supabase,user.id),
    getReliableCurrentInvoiceSnapshots(supabase,user.id),
    supabase.from("financial_people").select("id,name").eq("created_by",user.id).eq("is_active",true).is("archived_at",null).order("name"),
  ]);
  const people=peopleResult.data??[];
  const activeCards = data.cards.filter((card) => card.status === "active");
  const archivedCards = data.cards.filter(
    (card) =>
      card.status === "archived" ||
      card.credit_card_instruments?.some(
        (instrument) => instrument.user_archived_at,
      ),
  );
  const visibleCards = view === "archived" ? archivedCards : activeCards;
  const invoices = buildCurrentCardInvoices(
    activeCards,
    data.cardPurchases,
    new Date(),
    {storedInvoices},
  ).filter((invoice) =>
    ["open", "partially_paid", "estimated"].includes(invoice.status),
  );
  const resolvedInvoices = new Map(
    (await Promise.all(invoices.map(async invoice => {
      const resolved = await resolveOpenCardInvoice(supabase, user.id, {
        workspaceId: invoice.card.workspace_id ?? null,
        cardAccountId: invoice.card.id,
        referenceDate: new Date(),
      });
      if (!resolved) return null;
      const details = await getResolvedCardCycleDetails(supabase, user.id, {
        workspaceId,
        cycleId: resolved.cycleId,
        cardId: invoice.card.id,
      });
      return [invoice.card.id, { resolved, details }] as const;
    }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const currentInvoiceTotals = [...resolvedInvoices.values()]
    .map(value => value.resolved.displayTotal)
    .filter((value): value is number => value !== null);
  const currentInvoiceTotal = currentInvoiceTotals.length
    ? currentInvoiceTotals.reduce((sum, value) => sum + value, 0)
    : null;
  let analyticsEntries: InvoiceHistoryAnalyticsEntry[] = [];
  try {
    analyticsEntries = await getCreditCardInvoiceAnalyticsEntries(
      supabase,
      user.id,
      null,
    );
  } catch {
    // A indisponibilidade do histórico não bloqueia a fatura vigente.
  }
  const chartEntries = analyticsEntries.map(entry => {
    if (!["open", "estimated", "partially_paid"].includes(entry.status)) return entry;
    const current = resolvedInvoices.get(entry.cardId)?.resolved;
    if (!current?.displayTotal) return entry;
    return { ...entry, total: current.displayTotal, reliableTotal: current.displayTotal };
  });
  const invoiceAnalytics = buildInvoiceHistoryAnalytics(
    chartEntries,
    currentInvoiceTotal,
  );

  let historyError = false;
  let history: CreditCardInvoiceHistoryResult = {
    invoices: [],
    nextCursor: null,
    totalCount: 0,
    warnings: [],
    dataCompleteness: "complete",
  };
  if (view === "history") {
    try {
      history = await getCreditCardInvoiceHistory(supabase, user.id, {
        workspaceId,
        cardId: query.card,
        year,
        status,
        periodStart,
        cursor: query.cursor,
        limit: 12,
      });
    } catch {
      historyError = true;
    }
  }
  const historyYears = [
    ...new Set([
      ...Array.from({ length: 10 }, (_, index) => new Date().getFullYear() - index),
      ...history.invoices.map((invoice) => Number(invoice.dueDate.slice(0, 4))),
    ]),
  ].sort((left, right) => right - left);
  const nextParams = new URLSearchParams();
  nextParams.set("view", "history");
  if (query.workspace) nextParams.set("workspace", query.workspace);
  if (query.card) nextParams.set("card", query.card);
  if (query.year) nextParams.set("year", query.year);
  if (query.status) nextParams.set("status", query.status);
  if (query.period) nextParams.set("period", query.period);
  if (query.q) nextParams.set("q", query.q);
  if (history.nextCursor) nextParams.set("cursor", history.nextCursor);

  return (
    <ValueVisibility controls={false}>
      {query.toast === "restored" ? (
        <p className="finance-toast success" role="status">
          Cartão desarquivado com sucesso.
        </p>
      ) : query.toast === "responsibility-updated" ? (
        <p className="finance-toast success" role="status">
          Responsabilidade de pagamento atualizada.
        </p>
      ) : query.toast === "archived" ? (
        <p className="finance-toast success" role="status">
          Cartão arquivado com sucesso.
        </p>
      ) : query.sync === "partial" ? (
        <p className="finance-toast warning" role="status">
          Sincronização concluída com dados parciais. Os valores anteriores foram preservados.
        </p>
      ) : query.sync === "complete" ? (
        <p className="finance-toast success" role="status">
          Sincronização concluída com dados completos.
        </p>
      ) : null}

      <CreditCardViewTabs activeView={view} workspace={query.workspace} />

      {view === "history" ? (
        <>
        <div className="invoice-import-action-row"><ImportInvoiceButton /></div>
        <InvoiceConsumptionAnalytics analytics={invoiceAnalytics} />
        <InvoiceHistorySection
          result={history}
          cards={data.cards}
          years={historyYears}
          filters={{
            card: query.card,
            year: query.year,
            status: query.status,
            period: query.period,
            query: query.q,
          }}
          nextHref={
            history.nextCursor
              ? `/financeiro/cartoes?${nextParams.toString()}`
              : null
          }
          error={historyError}
          initialInvoiceId={query.invoice}
        /></>
      ) : null}

      {view === "current" ? (
        <>
          <section className="finance-panel">
            <header>
              <div>
                <p className="eyebrow">Crédito e faturas</p>
                <h2>Faturas vigentes</h2>
              </div>
              <form action={syncCurrentInvoicesAction}>
                <SubmitButton>Sincronizar agora</SubmitButton>
              </form>
              <ImportInvoiceButton compact />
            </header>
            {invoices.length ? (
              <div className="current-invoice-grid">
                {invoices.map((invoice) => (
                  <CurrentInvoiceCard
                    key={invoice.card.id}
                    invoice={invoice}
                    resolvedInvoice={
                      resolvedInvoices.get(invoice.card.id)?.resolved
                    }
                    resolvedDetails={
                      resolvedInvoices.get(invoice.card.id)?.details ?? undefined
                    }
                    compact
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhum cartão ativo"
                description="Cadastre um cartão ou conecte a Pluggy para importar compras."
              />
            )}
            <InvoiceConsumptionAnalytics analytics={invoiceAnalytics} />
          </section>

          {activeCards
            .filter((card) => !card.closing_day || !card.due_day)
            .map((card) => (
              <section
                id={`configurar-${card.id}`}
                className="finance-panel"
                key={card.id}
              >
                <header><h2>Configurar {card.name}</h2></header>
                <p className="invoice-helper">
                  A Pluggy não informou estas datas. Confira-as no aplicativo do banco.
                </p>
                <form action={updateCardDates} className="finance-form">
                  <input type="hidden" name="id" value={card.id} />
                  <label>Fechamento<input name="closing_day" type="number" min="1" max="31" required /></label>
                  <label>Vencimento<input name="due_day" type="number" min="1" max="31" required /></label>
                  <SubmitButton>Salvar configuração</SubmitButton>
                </form>
              </section>
            ))}
        </>
      ) : null}

      {view === "manage" || view === "archived" ? (
        <section className="finance-panel card-manager-panel">
          <header className="card-manager-heading">
            <span>
              <small>{view === "archived" ? "HISTÓRICO" : "CARTÕES CONECTADOS"}</small>
              <h2>{view === "archived" ? "Cartões arquivados" : "Gerenciar cartões"}</h2>
              <p>
                {view === "archived"
                  ? "Restaure um cartão para voltar a usá-lo nas faturas."
                  : "Os cartões são importados automaticamente pela Pluggy. Aqui você define apenas quem paga cada cartão."}
              </p>
            </span>
            <i>{visibleCards.length} {visibleCards.length === 1 ? "conta" : "contas"}</i>
          </header>
          {view === "manage" ? (
            <p className="card-manager-info">
              Quando outra pessoa é selecionada, o Atlas desconta as compras desse cartão somente da sua previsão. A fatura do banco continua integral.
            </p>
          ) : null}
          {visibleCards.length ? (
            <div className="card-manager-list">
              {visibleCards.map((card) => {
                const visibleInstruments = card.credit_card_instruments
                  ?.filter((instrument) =>
                    view === "archived"
                      ? Boolean(instrument.user_archived_at)
                      : !instrument.user_archived_at,
                  ) ?? [];
                return (
                  <article className="card-manager-account" key={card.id}>
                    <header className="card-manager-account-head">
                      <span>
                        <b>{card.name}</b>
                        <small>
                          {card.brand || "Cartão de crédito"} · final {card.last_four_digits || "••••"} · {card.source === "pluggy" ? "Pluggy" : "Manual"}
                        </small>
                      </span>
                      {view === "manage" || card.status === "archived" ? (
                        <div className="card-manager-account-action">
                          <CardStatusForm
                            action={card.status === "active" ? archiveCard : restoreCard}
                            cardId={card.id}
                            currentView={view}
                            mode={card.status === "active" ? "archive" : "restore"}
                          />
                        </div>
                      ) : null}
                    </header>
                    {visibleInstruments.length ? (
                      <div className="card-manager-instruments">
                        {visibleInstruments.map((instrument) => {
                    const instrumentTotal = invoices
                      .find((invoice) => invoice.card.id === card.id)
                      ?.instrumentTotals.find(
                        (total) => total.instrumentId === instrument.id,
                      );
                    const purchaseCount = instrumentTotal?.purchaseCount ?? 0;
                    const kindLabel = instrument.card_kind === "physical"
                      ? "Físico"
                      : instrument.card_kind === "virtual"
                        ? "Virtual"
                        : instrument.card_kind === "online"
                          ? "Online"
                          : instrument.card_kind === "additional"
                            ? "Adicional"
                            : "Tipo não identificado";
                    return (
                      <div className="card-manager-instrument" key={instrument.id}>
                        <div className="card-manager-instrument-main">
                          <span>
                            <b>
                              {instrument.display_name?.trim().toLocaleLowerCase("pt-BR") === "cartão"
                                ? `Cartão final ${instrument.last_four_digits || "••••"}`
                                : instrument.display_name || `Cartão final ${instrument.last_four_digits || "••••"}`}
                            </b>
                            <small>{kindLabel} · final {instrument.last_four_digits || "••••"} · {purchaseCount ? `${purchaseCount} ${purchaseCount === 1 ? "compra" : "compras"}` : "sem compras nesta fatura"}</small>
                          </span>
                          <strong><Money value={instrumentTotal?.netTotal ?? 0} /></strong>
                        </div>
                        <form action={updateCardInstrumentPaymentResponsibility} className="instrument-responsibility-form">
                          <input type="hidden" name="id" value={instrument.id} />
                          <label>
                            Responsável pelo pagamento
                            <select name="payment_responsible_person_id" defaultValue={instrument.payment_responsible_person_id??""}>
                              <option value="">Eu pago</option>
                              {people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
                            </select>
                          </label>
                          <button>Salvar</button>
                        </form>
                        <details className="card-manager-more">
                          <summary>Mais opções</summary>
                          <div>
                            <form action={updateCardInstrument} className="instrument-edit-form">
                              <input type="hidden" name="id" value={instrument.id} />
                              <label>
                                Nome exibido
                                <input name="display_name" defaultValue={instrument.display_name} aria-label="Nome do cartão" />
                              </label>
                              <label>
                                Tipo
                                <select name="card_kind" defaultValue={instrument.card_kind} aria-label="Tipo do cartão">
                                  <option value="unknown">Outro</option>
                                  <option value="physical">Físico</option>
                                  <option value="virtual">Virtual</option>
                                  <option value="online">Online</option>
                                  <option value="additional">Adicional</option>
                                </select>
                              </label>
                              <button>Salvar ajustes</button>
                            </form>
                            <div className="card-manager-instrument-action">
                              <CardStatusForm
                                action={instrument.user_archived_at ? restoreCardInstrument : archiveCardInstrument}
                                cardId={instrument.id}
                                currentView={view}
                                mode={instrument.user_archived_at ? "restore" : "archive"}
                              />
                            </div>
                          </div>
                        </details>
                      </div>
                    );
                        })}
                      </div>
                    ) : (
                      <p className="card-manager-empty-account">
                        {view === "archived" ? "Nenhum cartão adicional arquivado nesta conta." : "Nenhum cartão disponível nesta conta."}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title={view === "archived" ? "Nenhum cartão arquivado" : "Nenhum cartão nesta visualização"}
              description={
                view === "archived"
                  ? "Quando você arquivar um cartão, ele aparecerá aqui."
                  : "Conecte ou sincronize sua instituição pela Pluggy para importar os cartões."
              }
            />
          )}
        </section>
      ) : null}
    </ValueVisibility>
  );
}
