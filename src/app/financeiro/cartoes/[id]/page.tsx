import Link from "next/link";
import { notFound } from "next/navigation";
import { Money, ValueVisibility } from "@/components/finance/value-visibility";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  buildCurrentCardInvoices,
  calculateInvoiceAmounts,
  comparePreviousCycleAtSameStage,
  filterPurchasesByInstrument,
  getCurrentBillSummary,
} from "@/modules/finance/card-invoices";
import { formatDate } from "@/modules/finance/format";
import {
  getCardInvoiceHistory,
  getCreditCardInvoiceHistory,
  getFinanceData,
} from "@/modules/finance/queries";
import { assignPurchaseInstrument, confirmCurrentInvoiceAmount, updatePurchaseInstallment } from "@/modules/finance/actions";
import { buildFutureInstallmentProjection, estimatedInstallmentRemaining, installmentLabel, isInstallmentPurchase, matchesInstallmentFilter, type InstallmentFilter } from "@/modules/finance/installments";

const filters = {
  todas: null,
  compras: "consumption",
  parcelas: "installment",
  estornos: "refund",
  tarifas: "adjustment",
  pagamentos: "invoice_payment",
} as const;

export default async function CardInvoiceDetails({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ filtro?: string; instrumento?: string; parcelamento?:string; toast?:string; fatura?:string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const { supabase, user } = await requireFinanceAccess();
  const [data, invoiceHistory, normalizedHistory] = await Promise.all([
    getFinanceData(supabase, user.id),
    getCardInvoiceHistory(supabase, user.id, id),
    getCreditCardInvoiceHistory(supabase, user.id, {
      cardId: id,
      limit: 24,
    }),
  ]);
  const card = data.cards.find((item) => item.id === id);
  if (!card) notFound();
  const invoice = buildCurrentCardInvoices([card], data.cardPurchases)[0];
  const billSummary = getCurrentBillSummary(invoice);
  const invoiceTab = ["atual", "anteriores", "futuras"].includes(
    query.fatura ?? "",
  )
    ? query.fatura!
    : "atual";
  const historicalInvoices =
    invoiceTab === "anteriores"
      ? normalizedHistory.invoices
      : invoiceHistory.filter((item) =>
          Boolean(
          invoice.cycle &&
            item.cycle_start_date &&
            item.cycle_start_date > invoice.cycle.cycleEnd,
          ),
        );
  const comparison = comparePreviousCycleAtSameStage(invoice, data.cardPurchases);
  const activeFilter = query.filtro && query.filtro in filters ? query.filtro as keyof typeof filters : "todas";
  const installmentFilter:InstallmentFilter=["all","cash","installments","last","long"].includes(query.parcelamento??"")
    ? query.parcelamento as InstallmentFilter
    : "all";
  const role = filters[activeFilter];
  const visible = filterPurchasesByInstrument(invoice.purchases,query.instrumento??null).filter((purchase) =>
    (role === "installment"
      ? isInstallmentPurchase(purchase)
      : role
        ? purchase.transaction_role === role
        : true),
  ).filter(purchase=>matchesInstallmentFilter(purchase,installmentFilter));
  const grouped = Map.groupBy(visible, (purchase) => purchase.competence_date || purchase.purchase_date);
  const installmentGroups=Map.groupBy(invoice.purchases.filter(purchase=>Boolean(purchase.installment_plan_id)),purchase=>String(purchase.installment_plan_id));
  const selectedAmounts=visible.length?buildCurrentCardInvoices([card],visible)[0]:null;
  const postedAmounts=calculateInvoiceAmounts(invoice.purchases.filter(item=>item.status==="realized"));
  const withBillAmounts=calculateInvoiceAmounts(invoice.purchases.filter(item=>Boolean(item.provider_bill_id)));
  const withoutBillAmounts=calculateInvoiceAmounts(invoice.purchases.filter(item=>!item.provider_bill_id));
  const installmentAmounts=calculateInvoiceAmounts(invoice.purchases.filter(isInstallmentPurchase));

  return (
    <ValueVisibility controls={false}>
      <nav className="invoice-history-tabs" aria-label="Períodos da fatura">
        <Link
          className={invoiceTab === "atual" ? "active" : ""}
          href={`/financeiro/cartoes/${id}?fatura=atual`}
        >
          Atual
        </Link>
        <Link
          className={invoiceTab === "anteriores" ? "active" : ""}
          href={`/financeiro/cartoes/${id}?fatura=anteriores`}
        >
          Anteriores
        </Link>
        <Link
          className={invoiceTab === "futuras" ? "active" : ""}
          href={`/financeiro/cartoes/${id}?fatura=futuras`}
        >
          Futuras
        </Link>
      </nav>
      {invoiceTab === "atual" ? (
      <section className="finance-panel invoice-detail">
        <header>
          <div>
            <p className="eyebrow">Fatura vigente</p>
            <h2>{card.name} · {card.last_four_digits || "••••"}</h2>
          </div>
          <Link href="/financeiro/cartoes">Voltar</Link>
        </header>
        {!invoice.cycle ? (
          <p>Configure o fechamento e o vencimento para acompanhar a fatura corretamente.</p>
        ) : (
          <>
            <div className="invoice-detail-summary">
              <div><small>{billSummary.statusLabel}</small><strong>{billSummary.amount === null ? "Indisponível" : <Money value={billSummary.amount} />}</strong></div>
              <div><small>Compras importadas</small><strong>{billSummary.purchasesCount ?? "Indisponível"}</strong></div>
              <div><small>Movimentações conciliadas</small><strong><Money value={invoice.calculatedInvoiceTotal} /></strong></div>
              <div><small>Diferença ainda não detalhada</small><strong><Money value={Math.abs(invoice.reconciliationDifference??0)} /></strong></div>
              <div><small>Saldo em aberto</small><strong><Money value={invoice.outstandingAmount} /></strong></div>
              <div><small>Compras do ciclo</small><strong><Money value={invoice.purchasesTotal} /></strong></div>
              <div><small>Créditos e estornos</small><strong><Money value={-invoice.creditsTotal} /></strong></div>
              <div><small>Período</small><strong>{formatDate(billSummary.periodStart)} a {formatDate(billSummary.periodEnd)}</strong></div>
              <div><small>Fechamento</small><strong>{formatDate(billSummary.closesAt)}</strong></div>
              <div><small>Vencimento</small><strong>{formatDate(billSummary.dueAt)}</strong></div>
              <div><small>Limite total</small><strong><Money value={Number(card.credit_limit)} /></strong></div>
              <div><small>Limite disponível</small><strong><Money value={invoice.availableLimit} /></strong></div>
            </div>
            {billSummary.warningMessage ? (
              <p className="invoice-warning">{billSummary.warningMessage}</p>
            ) : null}
            <details className="invoice-reconciliation" open={invoice.reconciliationStatus==="divergent"}>
              <summary>Diagnóstico interno de conciliação</summary>
              <div className="invoice-detail-summary">
                <div><small>Fonte do total</small><strong>{invoice.totalSource==="provider_bill"?"Bill.totalAmount":invoice.totalSource==="manual_bank_confirmation"?"Confirmação manual do banco":"Transações calculadas"}</strong></div>
                <div><small>Account.balance (diagnóstico)</small><strong>{invoice.accountCreditBalance===null?"Não informado":<Money value={invoice.accountCreditBalance}/>}</strong></div>
                <div><small>Compras POSTED</small><strong>{invoice.postedTransactionsCount} · <Money value={postedAmounts.invoiceTotal}/></strong></div>
                <div><small>Compras PENDING</small><strong>{invoice.pendingTransactionsCount} · <Money value={invoice.pendingTransactionsTotal}/></strong></div>
                <div><small>Com billId</small><strong>{invoice.withBillIdCount} · <Money value={withBillAmounts.invoiceTotal}/></strong></div>
                <div><small>Sem billId</small><strong>{invoice.withoutBillIdCount} · <Money value={withoutBillAmounts.invoiceTotal}/></strong></div>
                <div><small>Instrumentos identificados</small><strong><Money value={invoice.instrumentsTotal}/></strong></div>
                <div><small>Sem instrumento</small><strong>{invoice.unassignedCount} · <Money value={invoice.unassignedTotal}/></strong></div>
                <div><small>Parcelas</small><strong><Money value={installmentAmounts.invoiceTotal}/></strong></div>
                <div><small>Tarifas e ajustes</small><strong><Money value={invoice.adjustmentsTotal}/></strong></div>
                <div><small>Estornos e créditos</small><strong><Money value={invoice.creditsTotal}/></strong></div>
                <div><small>Pagamentos excluídos</small><strong>{invoice.invoicePaymentsExcludedCount}</strong></div>
                <div><small>Diferença</small><strong><Money value={invoice.reconciliationDifference??0}/></strong></div>
              </div>
              {invoice.reconciliationStatus==="divergent"?<p className="invoice-warning">Existem lançamentos da fatura que ainda não foram totalmente conciliados pelo Atlas.</p>:null}
            </details>
            {query.toast==="invoice-confirmed"?<p className="finance-toast success">Valor atual da fatura registrado.</p>:null}
            {query.toast==="installment-updated"?<p className="finance-toast success">Parcelamento atualizado sem criar uma nova compra.</p>:null}
            {invoice.totalSource!=="provider_bill"?<form action={confirmCurrentInvoiceAmount} className="manual-invoice-form">
              <input type="hidden" name="card_id" value={card.id}/>
              <input type="hidden" name="reference_month" value={`${invoice.cycle.referenceMonth}-01`}/>
              <label><span>Informar valor atual da fatura</span><input name="official_amount" inputMode="decimal" placeholder="0,00" required/></label>
              <label><span>Observação opcional</span><input name="note" maxLength={300}/></label>
              <button>Salvar valor informado pelo banco</button>
            </form>:null}
            {comparison ? (
              <div className="invoice-comparison">
                <b>Comparação no {comparison.elapsedDays}º dia do ciclo</b>
                <span>Atual: <Money value={comparison.currentTotal} /></span>
                <span>Ciclo anterior: <Money value={comparison.previousTotal} /></span>
                <span>Variação: <Money value={comparison.difference} />{comparison.percentage === null ? "" : ` (${comparison.percentage >= 0 ? "+" : ""}${comparison.percentage.toFixed(0)}%)`}</span>
              </div>
            ) : null}
          </>
        )}
      </section>
      ) : (
        <section className="finance-panel invoice-history">
          <header>
            <div>
              <p className="eyebrow">
                {invoiceTab === "anteriores"
                  ? "Faturas anteriores"
                  : "Faturas futuras"}
              </p>
              <h2>{card.name}</h2>
            </div>
            <Link href={`/financeiro/cartoes/${id}?fatura=atual`}>
              Ver fatura atual
            </Link>
          </header>
          {historicalInvoices.length ? (
            <div className="invoice-history-list">
              {historicalInvoices.map((item) => {
                const cycleStart =
                  "cycleStartDate" in item
                    ? item.cycleStartDate
                    : item.cycle_start_date;
                const cycleEnd =
                  "cycleEndDate" in item
                    ? item.cycleEndDate
                    : item.cycle_end_date;
                const closingDate =
                  "closingDate" in item ? item.closingDate : item.closing_date;
                const dueDate =
                  "dueDate" in item ? item.dueDate : item.due_date;
                const total =
                  "total" in item ? item.total : Number(item.total_amount);
                return (
                <article key={item.id}>
                  <span>
                    <b>
                      {cycleStart && cycleEnd
                        ? `${formatDate(cycleStart)} a ${formatDate(cycleEnd)}`
                        : `Fechamento em ${formatDate(closingDate)}`}
                    </b>
                    <small>
                      Vencimento em {formatDate(dueDate)} ·{" "}
                      {item.status === "paid"
                        ? "Fatura paga"
                        : item.status === "overdue"
                          ? "Fatura vencida"
                          : item.status === "closed"
                            ? "Fatura fechada"
                            : item.status}
                    </small>
                  </span>
                  <strong>
                    {total === null ? "IndisponÃ­vel" : <Money value={total} />}
                  </strong>
                </article>
                );
              })}
            </div>
          ) : (
            <p className="invoice-empty">
              Nenhuma fatura disponível nesta visualização.
            </p>
          )}
        </section>
      )}

      {invoiceTab === "atual" ? (
      <section className="finance-panel invoice-purchases">
        {installmentGroups.size?<div className="installment-plan-groups">{[...installmentGroups.entries()].map(([planId,items])=>{const current=[...items].sort((left,right)=>Number(right.installment_number)-Number(left.installment_number))[0];const projections=buildFutureInstallmentProjection(current,items);return <details key={planId}><summary><b>{current.description}</b><span>{current.installment_count} parcelas · atual {current.installment_number}/{current.installment_count}</span></summary><p>Valor mensal: <Money value={Number(current.installment_amount)}/> · Restante estimado: <Money value={estimatedInstallmentRemaining(current)??0}/></p>{projections.length?<div>{projections.map(item=><small key={item.installmentNumber}>{formatDate(`${item.referenceMonth}-01`)}: parcela {item.installmentNumber}/{current.installment_count} · <Money value={item.amount}/></small>)}</div>:null}</details>})}</div>:null}
        {query.instrumento ? <div className="invoice-comparison"><b>{query.instrumento==="unassigned"?"Compras sem cartão identificado":`Cartão final ${card.credit_card_instruments?.find(item=>item.id===query.instrumento)?.last_four_digits??"••••"}`}</b><span>Total: <Money value={selectedAmounts?.calculatedInvoiceTotal??0}/></span><span>{selectedAmounts?.purchaseCount??0} compras</span></div>:null}
        {card.credit_card_instruments?.length ? (
          <nav aria-label="Filtrar pelo cartão utilizado">
            <Link href={`/financeiro/cartoes/${id}?filtro=${activeFilter}`}>Todos os cartões</Link>
            {card.credit_card_instruments.map((instrument) => (
              <Link key={instrument.id} className={query.instrumento === instrument.id ? "active" : ""} href={`/financeiro/cartoes/${id}?filtro=${activeFilter}&instrumento=${instrument.id}`}>
                Final {instrument.last_four_digits || "••••"}
              </Link>
            ))}
            <Link className={query.instrumento === "unassigned" ? "active" : ""} href={`/financeiro/cartoes/${id}?filtro=${activeFilter}&instrumento=unassigned`}>Sem identificação</Link>
          </nav>
        ) : null}
        <nav aria-label="Filtros da fatura">
          {Object.keys(filters).map((filter) => (
            <Link
              key={filter}
              className={filter === activeFilter ? "active" : ""}
              href={`/financeiro/cartoes/${id}?filtro=${filter}`}
            >
              {filter[0].toUpperCase() + filter.slice(1)}
            </Link>
          ))}
        </nav>
        <nav aria-label="Filtros de parcelamento">
          {([["all","Todas"],["cash","À vista"],["installments","Parceladas"],["last","Últimas parcelas"],["long","Parcelamentos longos"]] as const).map(([filter,label])=>(
            <Link key={filter} className={installmentFilter===filter?"active":""} href={`/financeiro/cartoes/${id}?filtro=${activeFilter}&parcelamento=${filter}${query.instrumento?`&instrumento=${query.instrumento}`:""}`}>{label}</Link>
          ))}
        </nav>
        {visible.length ? (
          <div className="invoice-purchase-groups">
            {[...grouped.entries()].map(([date, purchases]) => (
              <section key={date}>
                <h3>{formatDate(date)}</h3>
                {purchases.map((purchase) => (
                  <article key={purchase.id}>
                    <span>
                      <b>{purchase.description}</b>
                      <small>
                        {installmentLabel(purchase)
                          ? installmentLabel(purchase)
                          : purchase.transaction_role === "refund"
                            ? "Estorno ou crédito"
                            : purchase.transaction_role === "adjustment"
                              ? "Tarifa ou ajuste"
                              : purchase.transaction_role === "invoice_payment"
                                ? "Pagamento antecipado"
                                : purchase.provider_category || "Compra"}
                      </small>
                      {purchase.credit_card_instruments?.last_four_digits ? (
                        <small>Cartão final {purchase.credit_card_instruments.last_four_digits}</small>
                      ) : purchase.instrument_review_status === "pending" ? (
                        <small>Instrumento aguardando identificação</small>
                      ) : null}
                      <small>Data: {formatDate(purchase.purchase_date)} · Categoria: {purchase.financial_categories?.name||purchase.provider_category||"Sem categoria"} · Status: {purchase.status}</small>
                      {isInstallmentPurchase(purchase)&&purchase.total_purchase_amount!==null&&purchase.total_purchase_amount!==undefined?<small>Valor total da compra: <Money value={Number(purchase.total_purchase_amount)}/></small>:null}
                      {estimatedInstallmentRemaining(purchase)!==null?<small>Restante estimado: <Money value={estimatedInstallmentRemaining(purchase)??0}/></small>:null}
                      {purchase.installment_confidence==="unknown"?<small>Parcelamento não informado pelo banco.</small>:null}
                      {!purchase.instrument_id && card.credit_card_instruments?.length ? (
                        <form action={assignPurchaseInstrument} className="assignment-form">
                          <input type="hidden" name="purchase_id" value={purchase.id}/>
                          <select name="instrument_id" required aria-label="Associar ao cartão"><option value="">Selecionar cartão</option>{card.credit_card_instruments.map(instrument=><option key={instrument.id} value={instrument.id}>Final {instrument.last_four_digits||"••••"}</option>)}</select>
                          <button>Associar</button>
                        </form>
                      ) : null}
                      <details className="installment-editor">
                        <summary>Editar parcelamento</summary>
                        <form action={updatePurchaseInstallment}>
                          <input type="hidden" name="purchase_id" value={purchase.id}/>
                          <input type="hidden" name="card_id" value={card.id}/>
                          <label>Tipo<select name="purchase_kind" defaultValue={isInstallmentPurchase(purchase)?"installment":"cash"}><option value="cash">À vista</option><option value="installment">Parcelada</option></select></label>
                          <label>Parcela atual<input name="installment_number" type="number" min="1" defaultValue={purchase.installment_number??""}/></label>
                          <label>Total de parcelas<input name="installment_count" type="number" min="2" defaultValue={purchase.installment_count??""}/></label>
                          <label>Valor da parcela<input name="installment_amount" inputMode="decimal" required defaultValue={Number(purchase.installment_amount).toFixed(2).replace(".",",")}/></label>
                          <label>Valor total da compra<input name="total_purchase_amount" inputMode="decimal" defaultValue={purchase.total_purchase_amount===null||purchase.total_purchase_amount===undefined?"":Number(purchase.total_purchase_amount).toFixed(2).replace(".",",")}/></label>
                          <button>Salvar correção</button>
                        </form>
                      </details>
                    </span>
                    <strong className={["refund", "invoice_payment"].includes(purchase.transaction_role) ? "positive" : ""}>
                      <Money value={["refund", "invoice_payment"].includes(purchase.transaction_role) ? -Number(purchase.installment_amount) : Number(purchase.installment_amount)} />
                    </strong>
                  </article>
                ))}
              </section>
            ))}
          </div>
        ) : (
          <p className="invoice-empty">Você ainda não possui compras nesta fatura.</p>
        )}
      </section>
      ) : null}
    </ValueVisibility>
  );
}
