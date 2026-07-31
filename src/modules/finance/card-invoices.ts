import { getCurrentBillingCycle, type BillingCycle } from "./billing-cycle";
import type { CardPurchase, CreditCard, OfficialBillFinanceCharge, OfficialBillPayment, StoredCardInvoice } from "./types";
import {resolveInvoiceDisplayTotal,type InvoiceTotalSource} from "@/lib/pluggy/bill-domain";
import { persistedCardMovementAmountBrl } from "./foreign-card-movement";

const amount = (value: number | string | null | undefined) =>
  Math.abs(Number(value ?? 0));
const DAY_MS = 86_400_000;
const PENDING_CUTOFF_GRACE_DAYS = 2;

export interface CurrentCardInvoice {
  card: CreditCard;
  cycle: BillingCycle | null;
  purchases: CardPurchase[];
  purchasesTotal: number;
  creditsTotal: number;
  adjustmentsTotal: number;
  invoiceTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  purchaseCount: number;
  reliablePurchaseCount:number|null;
  providerInvoiceTotal: number | null;
  manualInvoiceTotal:number|null;
  confirmedInvoiceTotal:number|null;
  lastReliableInvoiceTotal:number|null;
  lastReliableValueReliable:boolean;
  providerValueReliable:boolean;
  calculatedValueReliable:boolean;
  preservationReason:string|null;
  lastCompleteSyncAt:string|null;
  lastAttemptAt:string|null;
  accountCreditBalance: number | null;
  calculatedInvoiceTotal: number;
  totalSource:"provider_bill"|"manual_bank_confirmation"|"calculated_transactions";
  pendingTransactionsTotal:number;
  pendingTransactionsCount:number;
  postedTransactionsCount:number;
  withBillIdCount:number;
  withoutBillIdCount:number;
  invoicePaymentsExcludedCount:number;
  cycleEstimated:boolean;
  reconciliationDifference: number | null;
  reconciliationStatus:
    | "matched"
    | "small_difference"
    | "divergent"
    | "incomplete_assignment"
    | "provider_unavailable"
    | "incomplete_transactions";
  committedLimit: number;
  availableLimit: number|null;
  usedPercent: number;
  isStale: boolean;
  instrumentTotals: Array<{instrumentId:string;lastFour:string|null;cardKind:string;displayName:string;grossTotal:number;creditsTotal:number;adjustmentsTotal:number;netTotal:number;purchaseCount:number;responsiblePersonId:string|null;responsiblePersonName:string|null}>;
  thirdPartyResponsibleTotal:number;
  ownerResponsibleTotal:number;
  instrumentsTotal:number;
  unassignedTotal:number;
  unassignedCount:number;
  generalAdjustmentsTotal:number;
  excludedItems: InvoiceExcludedItem[];
  linkedPayments: CardPurchase[];
  purchaseDataAvailable: boolean;
  isPartial:boolean;
  reliableSnapshotUsed:boolean;
  officialPayments:OfficialBillPayment[];
  financeCharges:OfficialBillFinanceCharge[];
  paymentStatus:string|null;
  status:"open"|"closed"|"due"|"partially_paid"|"paid"|"overdue"|"estimated";
}

export type InvoiceExclusionReason =
  | "outside_cycle"
  | "cancelled"
  | "duplicate"
  | "invoice_payment"
  | "invalid_date"
  | "awaiting_review"
  | "unsupported";

export type InvoiceExcludedItem = {
  purchase: CardPurchase;
  reason: InvoiceExclusionReason;
};

export type EstimatedInvoiceLineKind =
  | "purchase"
  | "installment"
  | "refund"
  | "credit"
  | "fee"
  | "adjustment";

export type EstimatedInvoiceDetails = {
  includedPurchases: CardPurchase[];
  excludedItems: InvoiceExcludedItem[];
  linkedPayments: CardPurchase[];
  purchaseTotal: number;
  refundTotal: number;
  creditTotal: number;
  feeTotal: number;
  adjustmentTotal: number;
  calculatedTotal: number;
  displayedTotal: number;
  providerTotal: number | null;
  reconciliationDifference: number | null;
  reconciliationStatus: CurrentCardInvoice["reconciliationStatus"];
  purchaseCount: number;
  dataCompleteness: "complete" | "partial" | "stale";
  warnings: string[];
};

export type CurrentBillSummary = {
  amount: number | null;
  amountSource: CurrentCardInvoice["totalSource"];
  purchasesCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  closesAt: string | null;
  dueAt: string | null;
  statusLabel: string;
  warningMessage: string | null;
  isEstimated: boolean;
  isOfficial: boolean;
  resolvedSource:InvoiceTotalSource;
  isReliable:boolean;
  isPartial:boolean;
};

export type CurrentInvoiceSummary = {
  id: string;
  cardId: string;
  cardName: string;
  brand: string;
  lastFour: string;
  status: CurrentCardInvoice["status"];
  statusLabel: string;
  displayAmount: number | null;
  amountSource: CurrentCardInvoice["totalSource"];
  amountSourceLabel: string;
  cycleStart: string | null;
  cycleEnd: string | null;
  closingDate: string | null;
  dueDate: string | null;
  purchaseCount: number | null;
  lastUpdatedAt: string | null;
  dataCompleteness: "complete" | "partial" | "stale" | "unavailable";
  warningMessage: string | null;
  isEstimated: boolean;
  isOfficial: boolean;
};

export function purchaseCompetenceDate(purchase: CardPurchase) {
  const projected =
    purchase.source === "projection" || purchase.status === "projected";
  if (projected) {
    return (
      purchase.bill_forecast_date ||
      purchase.competence_date ||
      purchase.purchase_date ||
      ""
    );
  }
  return (
    purchase.purchase_date ||
    purchase.posting_date ||
    purchase.competence_date ||
    purchase.bill_forecast_date ||
    ""
  );
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setTime(date.getTime() + days * DAY_MS);
  return date.toISOString().slice(0, 10);
}

/**
 * A card purchase can be authorized before the closing date and only settle
 * after the bill closes. Until Pluggy supplies a definitive billId, keep
 * pending purchases from the cutoff window in the current open bill estimate.
 * A provider bill reference always wins over this provisional rule.
 */
export function isPendingPurchaseCarriedIntoOpenCycle(
  purchase: CardPurchase,
  cycle: BillingCycle,
) {
  if (
    purchase.status !== "pending" ||
    purchase.provider_bill_id ||
    purchase.invoice_reference
  ) {
    return false;
  }
  const date = purchaseCompetenceDate(purchase);
  if (!date) return false;
  const graceStart = addIsoDays(
    cycle.cycleStart,
    -PENDING_CUTOFF_GRACE_DAYS,
  );
  return date >= graceStart && date < cycle.cycleStart;
}

const normalizedDescription = (purchase: CardPurchase) =>
  (purchase.merchant || purchase.description)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");

const purchaseTimestamp = (purchase: CardPurchase) =>
  new Date(`${purchase.purchase_date}T12:00:00Z`).valueOf();

function hasConflictingInstallmentDuplicate(
  left: CardPurchase,
  right: CardPurchase,
) {
  return (
    left.source === "pluggy" &&
    right.source === "pluggy" &&
    left.invoice_id === null &&
    right.invoice_id === null &&
    left.card_id === right.card_id &&
    left.installment_count !== null &&
    left.installment_count === right.installment_count &&
    left.installment_count > 1 &&
    left.installment_number !== null &&
    right.installment_number !== null &&
    left.installment_number !== right.installment_number &&
    Math.abs(purchaseTimestamp(left) - purchaseTimestamp(right)) === 0 &&
    Math.abs(
      Number(left.installment_amount) - Number(right.installment_amount),
    ) <= 0.01 &&
    normalizedDescription(left) === normalizedDescription(right)
  );
}

function preferPosted(left: CardPurchase, right: CardPurchase) {
  if (left.invoice_id && !right.invoice_id) return right;
  if (right.invoice_id && !left.invoice_id) return left;
  if (left.status === "pending" && right.status !== "pending") return right;
  if (right.status === "pending" && left.status !== "pending") return left;
  return purchaseTimestamp(right) >= purchaseTimestamp(left) ? right : left;
}

export function deduplicateCardPurchases(purchases: CardPurchase[]) {
  const byExternal = new Map<string, CardPurchase>();
  const withoutExternal: CardPurchase[] = [];
  for (const purchase of purchases) {
    if (!purchase.external_id) {
      withoutExternal.push(purchase);
      continue;
    }
    const previous = byExternal.get(purchase.external_id);
    byExternal.set(
      purchase.external_id,
      previous ? preferPosted(previous, purchase) : purchase,
    );
  }

  const candidates = [...byExternal.values(), ...withoutExternal].sort(
    (left, right) =>
      left.status === "pending" === (right.status === "pending")
        ? purchaseTimestamp(left) - purchaseTimestamp(right)
        : left.status === "pending"
          ? 1
          : -1,
  );
  const result: CardPurchase[] = [];
  for (const purchase of candidates) {
    const duplicate = result.find((existing) =>
      hasConflictingInstallmentDuplicate(existing, purchase) ||
      (
        existing.card_id === purchase.card_id &&
        existing.transaction_role === purchase.transaction_role &&
        new Set([existing.status, purchase.status]).size === 2 &&
        [existing.status, purchase.status].every((status) =>
          ["pending", "realized"].includes(status),
        ) &&
        Math.abs(
          Number(existing.installment_amount) -
            Number(purchase.installment_amount),
        ) <= 0.01 &&
        normalizedDescription(existing) === normalizedDescription(purchase) &&
        Math.abs(purchaseTimestamp(existing) - purchaseTimestamp(purchase)) <=
          3 * 86_400_000
      ),
    );
    if (!duplicate) result.push(purchase);
  }
  return result;
}

function calendarDate(date: Date, timeZone = "America/Sao_Paulo") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function deriveInvoiceStatus({
  cycle,
  invoiceTotal,
  paidAmount,
  referenceDate = new Date(),
}: {
  cycle: BillingCycle | null;
  invoiceTotal: number;
  paidAmount: number;
  referenceDate?: Date;
}): CurrentCardInvoice["status"] {
  if (!cycle) return "estimated";
  const reference = calendarDate(referenceDate);
  if (paidAmount >= invoiceTotal && invoiceTotal > 0) return "paid";
  if (paidAmount > 0) return "partially_paid";
  if (reference <= cycle.cycleEnd) return "open";
  if (reference === cycle.dueDate) return "due";
  if (reference > cycle.dueDate) return "overdue";
  return "closed";
}

export function invoiceReferenceDateForMonth({
  year,
  month,
  now = new Date(),
  timeZone = "America/Sao_Paulo",
}: {
  year: number;
  month: number;
  now?: Date;
  timeZone?: string;
}) {
  const current = calendarDate(now, timeZone);
  const selected = `${year}-${String(month).padStart(2, "0")}`;
  if (current.startsWith(selected)) return now;
  return new Date(Date.UTC(year, month, 0, 12));
}
export function filterPurchasesByInstrument(purchases:CardPurchase[],instrumentId:string|null){return instrumentId==="unassigned"?purchases.filter(purchase=>!purchase.instrument_id):instrumentId?purchases.filter(purchase=>purchase.instrument_id===instrumentId):purchases}
export function analyzeInvoiceInclusion(card:CreditCard,purchases:CardPurchase[],referenceDate=new Date()){const invoice=buildCurrentCardInvoices([card],purchases,referenceDate)[0];const counts={outside_cycle:0,invoice_payment:0,cancelled:0,duplicate:0,invalid_target:0,missing_card_relation:0,pending_not_included:0,missing_bill_id:0,unsupported_type:0,mapping_failure:0};const includedIds=new Set(invoice.purchases.filter(purchase=>purchase.status!=="cancelled"&&purchase.transaction_role!=="invoice_payment").map(purchase=>purchase.id));const seen=new Set<string>();for(const purchase of purchases){const key=purchase.external_id??purchase.id;if(seen.has(key)){counts.duplicate++;continue}seen.add(key);if(purchase.card_id!==card.id){counts.missing_card_relation++;continue}if(purchase.status==="cancelled"){counts.cancelled++;continue}if(purchase.transaction_role==="invoice_payment"){counts.invoice_payment++;continue}if(!purchase.provider_bill_id)counts.missing_bill_id++;if(!includedIds.has(purchase.id)){counts.outside_cycle++;if(purchase.status==="pending")counts.pending_not_included++}}return {includedCount:includedIds.size,excludedCount:purchases.length-includedIds.size,exclusionCounts:counts}}

export function calculateInvoiceAmounts(purchases: CardPurchase[]) {
  let purchasesTotal = 0;
  let creditsTotal = 0;
  let adjustmentsTotal = 0;
  let paidAmount = 0;
  let purchaseCount = 0;

  for (const purchase of purchases) {
    if (
      purchase.status === "cancelled" ||
      (purchase.review_status === "pending" &&
        purchase.transaction_role !== "invoice_payment")
    )
      continue;
    const value = amount(persistedCardMovementAmountBrl(purchase));
    if (
      purchase.transaction_role === "consumption" ||
      purchase.transaction_role === "foreign_transaction_tax"
    ) {
      purchasesTotal += value;
      purchaseCount++;
    } else if (purchase.transaction_role === "refund") {
      creditsTotal += value;
    } else if (purchase.transaction_role === "invoice_payment") {
      paidAmount += value;
    } else if (purchase.transaction_role === "adjustment") {
      // Pluggy keeps the provider sign in original_amount. Positive card entries
      // are credits; negative entries are charges.
      if (Number(purchase.original_amount ?? -value) > 0) creditsTotal += value;
      else adjustmentsTotal += value;
    }
  }
  const invoiceTotal = purchasesTotal + adjustmentsTotal - creditsTotal;
  return {
    purchasesTotal,
    creditsTotal,
    adjustmentsTotal,
    invoiceTotal,
    paidAmount,
    outstandingAmount: Math.max(0, invoiceTotal - paidAmount),
    purchaseCount,
  };
}

export function invoiceLineKind(
  purchase: CardPurchase,
): EstimatedInvoiceLineKind {
  if (
    purchase.transaction_role === "foreign_transaction_tax" ||
    purchase.entry_type === "tax"
  ) return "fee";
  if (purchase.transaction_role === "refund") return "refund";
  if (purchase.transaction_role === "adjustment") {
    if (Number(purchase.original_amount ?? -purchase.installment_amount) > 0) {
      return "credit";
    }
    const clue =
      `${purchase.description} ${purchase.provider_category ?? ""}`.toLocaleLowerCase(
        "pt-BR",
      );
    return /tarifa|taxa|fee|encargo|juros|multa|anuidade/.test(clue)
      ? "fee"
      : "adjustment";
  }
  return purchase.is_installment ||
    (purchase.installment_count !== null && purchase.installment_count > 1)
    ? "installment"
    : "purchase";
}

export function invoiceLineContribution(purchase: CardPurchase) {
  const value = amount(persistedCardMovementAmountBrl(purchase));
  return ["refund", "credit"].includes(invoiceLineKind(purchase))
    ? -value
    : value;
}

export function isInvoiceTotalLine(purchase: CardPurchase) {
  return (
    purchase.status !== "cancelled" &&
    purchase.transaction_role !== "invoice_payment" &&
    purchase.review_status !== "pending"
  );
}

export function getCurrentBillSummary(
  invoice: CurrentCardInvoice,
): CurrentBillSummary {
  const resolved=resolveInvoiceDisplayTotal({
    providerInvoiceTotal:invoice.providerInvoiceTotal,
    providerReliable:invoice.providerValueReliable,
    manualInvoiceTotal:invoice.manualInvoiceTotal,
    confirmedInvoiceTotal:invoice.confirmedInvoiceTotal,
    calculatedInvoiceTotal:invoice.calculatedInvoiceTotal,
    calculatedReliable:invoice.calculatedValueReliable,
    lastReliableInvoiceTotal:invoice.lastReliableInvoiceTotal,
    lastReliableReliable:invoice.lastReliableValueReliable,
    isPartial:invoice.isPartial,
  });
  const providerAmount=resolved.source==="provider_bill"?resolved.amount:null;
  const manualAmount=["manual","confirmed"].includes(resolved.source)
    ? resolved.amount
    : null;
  const calculatedAmount=["calculated","last_reliable"].includes(resolved.source)
    ? resolved.amount
    : null;
  const amountSource =
    providerAmount !== null
      ? "provider_bill"
      : manualAmount !== null
        ? "manual_bank_confirmation"
        : "calculated_transactions";
  const amount = providerAmount ?? manualAmount ?? calculatedAmount;
  const partial=invoice.isPartial;
  const purchasesCount = invoice.reliablePurchaseCount!==null
    ? invoice.reliablePurchaseCount
    : partial&&invoice.purchaseCount===0
      ? null
      : invoice.purchaseDataAvailable
      ? invoice.purchases.filter(
        (purchase) =>
          isInvoiceTotalLine(purchase) &&
          purchase.transaction_role === "consumption",
        ).length
      : null;
  const statusLabel =
    invoice.status === "open"
      ? "Fatura aberta"
      : invoice.status === "paid"
        ? "Fatura paga"
        : invoice.status === "partially_paid"
          ? "Fatura parcialmente paga"
          : invoice.status === "overdue"
            ? "Fatura vencida"
            : invoice.status === "due"
              ? "Fatura vence hoje"
              : invoice.status === "closed"
                ? "Fatura fechada"
                : "Fatura estimada";
  const warningMessage = !invoice.purchaseDataAvailable&&!invoice.reliableSnapshotUsed
    ? "As compras importadas estão temporariamente indisponíveis. Nenhum valor calculado foi substituído por zero."
    : partial
    ? resolved.source==="last_reliable"
      ? "Último valor confiável preservado."
      : resolved.source==="unavailable"
        ? "A instituição não enviou dados suficientes nesta atualização."
        : amountSource === "calculated_transactions"
          ? "Dados parciais da conexão. O valor calculado pelas movimentações importadas foi preservado."
          : "Dados parciais fornecidos pela conexão. O último valor confiável foi preservado."
    : invoice.isStale
      ? "Os valores podem estar desatualizados."
      : amountSource === "calculated_transactions"
        ? "A conexão não forneceu uma fatura oficial. O valor foi calculado pelas movimentações."
        : null;

  return {
    amount,
    amountSource,
    purchasesCount,
    periodStart: invoice.cycle?.cycleStart ?? null,
    periodEnd: invoice.cycle?.cycleEnd ?? null,
    closesAt: invoice.cycle?.closingDate ?? null,
    dueAt: invoice.cycle?.dueDate ?? null,
    statusLabel,
    warningMessage,
    isEstimated:
      amount !== null && amountSource === "calculated_transactions",
    isOfficial: amountSource === "provider_bill",
    resolvedSource:resolved.source,
    isReliable:resolved.isReliable,
    isPartial:resolved.isPartial,
  };
}

function daysBetweenCalendarDates(left: string, right: string) {
  const leftTime = Date.parse(`${left.slice(0, 10)}T12:00:00Z`);
  const rightTime = Date.parse(`${right.slice(0, 10)}T12:00:00Z`);
  return Math.round((rightTime - leftTime) / 86_400_000);
}

function getTemporalInvoiceStatusLabel(
  invoice: CurrentCardInvoice,
  summary: CurrentBillSummary,
  referenceDate: Date,
) {
  if (["paid", "partially_paid"].includes(invoice.status)) {
    return summary.statusLabel;
  }

  const today = calendarDate(referenceDate);
  const daysUntilDue = summary.dueAt
    ? daysBetweenCalendarDates(today, summary.dueAt)
    : null;
  if (daysUntilDue !== null && daysUntilDue < 0) return "Fatura vencida";
  if (daysUntilDue === 0) return "Vence hoje";
  if (daysUntilDue === 1) return "Vence amanhã";

  const daysUntilClosing = summary.closesAt
    ? daysBetweenCalendarDates(today, summary.closesAt)
    : null;
  if (daysUntilClosing === 0) return "Fecha hoje";
  if (daysUntilClosing === 1) return "Fecha amanhã";
  return summary.statusLabel;
}

export function getCurrentInvoiceSummary(
  invoice: CurrentCardInvoice,
  referenceDate = new Date(),
): CurrentInvoiceSummary {
  const bill = getCurrentBillSummary(invoice);
  const manualDate = invoice.cycle
    ? invoice.card.card_invoice_confirmations?.find(
        (item) =>
          item.reference_month.slice(0, 7) === invoice.cycle?.referenceMonth,
      )?.informed_at ?? null
    : null;
  const partial=invoice.isPartial;
  const lastUpdatedAt =
    bill.amountSource === "provider_bill"
      ? invoice.card.bank_connections?.last_complete_sync_at ?? null
      : bill.amountSource === "manual_bank_confirmation"
        ? manualDate
        : partial
          ? invoice.card.bank_connections?.last_complete_sync_at??invoice.card.last_sync_at
          : invoice.card.last_sync_at;
  const dataCompleteness = !invoice.purchaseDataAvailable&&!invoice.reliableSnapshotUsed
    ? "unavailable"
    : partial
      ? "partial"
      : invoice.isStale
        ? "stale"
        : "complete";

  return {
    id: `${invoice.card.id}:${invoice.cycle?.referenceMonth ?? "unconfigured"}`,
    cardId: invoice.card.id,
    cardName: invoice.card.name,
    brand: invoice.card.brand || invoice.card.institution_name || "Cartão",
    lastFour: invoice.card.last_four_digits || "••••",
    status: invoice.status,
    statusLabel: getTemporalInvoiceStatusLabel(invoice, bill, referenceDate),
    displayAmount: bill.amount,
    amountSource: bill.amountSource,
    amountSourceLabel:
      bill.resolvedSource === "provider_bill"
        ? "Valor oficial"
        : ["manual","confirmed"].includes(bill.resolvedSource)
          ? "Valor informado"
          : bill.resolvedSource==="last_reliable"
            ? "Último valor confiável"
            : bill.resolvedSource==="unavailable"
              ? "Indisponível"
              : "Valor estimado",
    cycleStart: bill.periodStart,
    cycleEnd: bill.periodEnd,
    closingDate: bill.closesAt,
    dueDate: bill.dueAt,
    purchaseCount: bill.purchasesCount,
    lastUpdatedAt,
    dataCompleteness,
    warningMessage:
      dataCompleteness === "unavailable"
        ? "Compras temporariamente indisponíveis."
        : dataCompleteness === "partial"
          ? bill.warningMessage??"Alguns dados podem estar incompletos."
          : dataCompleteness === "stale"
            ? "Atualização pendente."
            : null,
    isEstimated: bill.isEstimated,
    isOfficial: bill.isOfficial,
  };
}

export function getEstimatedInvoiceDetails(
  invoice: CurrentCardInvoice,
): EstimatedInvoiceDetails {
  const includedPurchases = invoice.purchases.filter(isInvoiceTotalLine);
  let purchaseTotal = 0;
  let refundTotal = 0;
  let creditTotal = 0;
  let feeTotal = 0;
  let adjustmentTotal = 0;

  for (const purchase of includedPurchases) {
    const value = amount(persistedCardMovementAmountBrl(purchase));
    const kind = invoiceLineKind(purchase);
    if (kind === "refund") refundTotal += value;
    else if (kind === "credit") creditTotal += value;
    else if (kind === "fee") feeTotal += value;
    else if (kind === "adjustment") adjustmentTotal += value;
    else purchaseTotal += value;
  }

  const calculatedTotal =
    purchaseTotal + feeTotal + adjustmentTotal - refundTotal - creditTotal;
  const partial=invoice.isPartial;
  const warnings = [
    ...(partial ? ["Os dados desta fatura podem estar incompletos."] : []),
    ...(invoice.isStale ? ["Os valores podem estar desatualizados."] : []),
  ];

  const summary = getCurrentBillSummary(invoice);

  return {
    includedPurchases,
    excludedItems: invoice.excludedItems,
    linkedPayments: invoice.linkedPayments,
    purchaseTotal,
    refundTotal,
    creditTotal,
    feeTotal,
    adjustmentTotal,
    calculatedTotal,
    displayedTotal: summary.amount ?? 0,
    providerTotal: invoice.providerInvoiceTotal ?? invoice.manualInvoiceTotal,
    reconciliationDifference: invoice.reconciliationDifference,
    reconciliationStatus: invoice.reconciliationStatus,
    purchaseCount:
      summary.purchasesCount ??
      includedPurchases.filter(
        (purchase) => purchase.transaction_role === "consumption",
      ).length,
    dataCompleteness: partial
      ? "partial"
      : invoice.isStale
        ? "stale"
        : "complete",
    warnings,
  };
}

function optionalStoredNumber(value:unknown){
  if(value===null||value===undefined)return null;
  const parsed=typeof value==="number"?value:Number(value);
  return Number.isFinite(parsed)?Math.abs(parsed):null;
}

function snapshotScore(invoice:StoredCardInvoice){
  const reliable=optionalStoredNumber(invoice.last_reliable_invoice_total);
  const calculated=optionalStoredNumber(invoice.calculated_invoice_total);
  const count=optionalStoredNumber(invoice.last_reliable_purchase_count) ??
    optionalStoredNumber(invoice.purchase_count);
  return (invoice.provider_bill_id?100:0)+
    (reliable!==null&&reliable>0?80:0)+
    (calculated!==null&&calculated>0?60:0)+
    (invoice.manual_invoice_total!==null?50:0)+
    (invoice.confirmed_invoice_total!==null?50:0)+
    (count!==null&&count>0?30:0)+
    (invoice.last_complete_sync_at?20:0)+
    (invoice.data_completeness==="complete"?10:0)+
    (invoice.updated_at?Date.parse(invoice.updated_at)/1e15:0);
}

export function selectStoredInvoiceSnapshot(input:{
  invoices:StoredCardInvoice[];
  card:CreditCard;
  referenceMonth:string;
}){
  return input.invoices
    .filter(invoice=>
      invoice.card_id===input.card.id&&
      invoice.reference_month.slice(0,7)===input.referenceMonth&&
      (!invoice.provider_account_id||!input.card.external_id||
        invoice.provider_account_id===input.card.external_id))
    .sort((left,right)=>snapshotScore(right)-snapshotScore(left))[0];
}

export function buildCurrentCardInvoices(
  cards: CreditCard[],
  purchases: CardPurchase[],
  referenceDate = new Date(),
  options: {
    purchaseDataAvailable?: boolean;
    storedInvoices?:StoredCardInvoice[];
  } = {},
): CurrentCardInvoice[] {
  return cards.map((card) => {
    const estimatedCycle =
      card.closing_day && card.due_day
        ? getCurrentBillingCycle({
            closingDay: card.closing_day,
            dueDay: card.due_day,
            referenceDate,
          })
        : null;
    const cycle=estimatedCycle;
    const storedInvoice=cycle&&options.storedInvoices
      ? selectStoredInvoiceSnapshot({
          invoices:options.storedInvoices,
          card,
          referenceMonth:cycle.referenceMonth,
        })
      : undefined;
    const partial=card.provider_status==="degraded"||
      card.bank_connections?.data_completeness==="partial"||
      storedInvoice?.data_completeness==="partial";
    const exactClosing=card.provider_bill_closing_date?.slice(0,10)??null;
    const exactDue=card.provider_bill_due_date?.slice(0,10)??null;
    const providerBillMatchesCycle=Boolean(
      cycle &&
        exactClosing === cycle.closingDate &&
        exactDue === cycle.dueDate &&
        (!card.provider_cycle_start_date ||
          card.provider_cycle_start_date.slice(0, 10) === cycle.cycleStart),
    );
    const allCardPurchases = purchases.filter(
      (purchase) => purchase.card_id === card.id,
    );
    const uniquePurchases = deduplicateCardPurchases(allCardPurchases);
    const uniqueIds = new Set(uniquePurchases.map((purchase) => purchase.id));
    const duplicateItems: InvoiceExcludedItem[] = allCardPurchases
      .filter((purchase) => !uniqueIds.has(purchase.id))
      .map((purchase) => ({ purchase, reason: "duplicate" }));
    const cardPurchases = cycle
      ? uniquePurchases.filter((purchase) => {
          const date = purchaseCompetenceDate(purchase);
          const matchesProviderBill =
            providerBillMatchesCycle &&
            Boolean(card.provider_bill_id) &&
            (purchase.provider_bill_id === card.provider_bill_id ||
              purchase.invoice_reference === card.provider_bill_id);
          const belongsToAnotherStoredInvoice = Boolean(
            purchase.invoice_id && purchase.invoice_id !== storedInvoice?.id,
          );
          const belongsToAnotherProviderBill = Boolean(
            card.provider_bill_id &&
            (purchase.provider_bill_id || purchase.invoice_reference) &&
            !matchesProviderBill,
          );
          // The provider may retain an old transaction date after settlement,
          // but a persisted invoice/bill link is authoritative for membership.
          if (belongsToAnotherStoredInvoice || belongsToAnotherProviderBill) {
            return false;
          }
          if (purchase.transaction_role === "invoice_payment") {
            return (
              matchesProviderBill ||
              (date > cycle.cycleEnd && date <= cycle.dueDate)
            );
          }
          return (
            matchesProviderBill ||
            isPendingPurchaseCarriedIntoOpenCycle(purchase, cycle) ||
            (date >= cycle.cycleStart && date <= cycle.cycleEnd)
          );
        })
      : [];
    const liveTotals=calculateInvoiceAmounts(cardPurchases);
    const storedPurchaseCount=optionalStoredNumber(
      storedInvoice?.last_reliable_purchase_count??
      storedInvoice?.purchase_count,
    );
    const storedCalculated=optionalStoredNumber(
      storedInvoice?.last_reliable_invoice_total??
      storedInvoice?.current_display_total??
      storedInvoice?.calculated_invoice_total,
    );
    const storedTotalReliable=storedCalculated!==null&&(
      storedCalculated>0||Boolean(storedInvoice?.last_complete_sync_at)
    );
    const storedCountReliable=storedPurchaseCount!==null&&(
      storedPurchaseCount>0||Boolean(storedInvoice?.last_complete_sync_at)
    );
    const reliableTotalUsed=Boolean(
      partial&&liveTotals.purchaseCount===0&&storedTotalReliable,
    );
    const reliableCountUsed=Boolean(
      partial&&liveTotals.purchaseCount===0&&storedCountReliable,
    );
    const reliableSnapshotUsed=reliableTotalUsed||reliableCountUsed;
    const totals={
      ...liveTotals,
      ...(reliableTotalUsed
        ? {
            purchasesTotal:Number(storedCalculated),
            invoiceTotal:Number(storedCalculated),
            outstandingAmount:Math.max(
              0,
              Number(storedCalculated)-liveTotals.paidAmount,
            ),
          }
        : {}),
      ...(reliableCountUsed
        ? {purchaseCount:Number(storedPurchaseCount)}
        : {}),
    };
    const includedIds = new Set(
      cardPurchases.filter(isInvoiceTotalLine).map((purchase) => purchase.id),
    );
    const linkedPayments = cardPurchases.filter(
      (purchase) =>
        purchase.status !== "cancelled" &&
        purchase.transaction_role === "invoice_payment",
    );
    const excludedItems: InvoiceExcludedItem[] = [
      ...duplicateItems,
      ...uniquePurchases
        .filter((purchase) => !includedIds.has(purchase.id))
        .map((purchase): InvoiceExcludedItem => {
          const date = purchaseCompetenceDate(purchase);
          const inCycle = Boolean(
            cycle &&
              date &&
              date >= cycle.cycleStart &&
              date <= cycle.cycleEnd,
          );
          const reason: InvoiceExclusionReason =
            purchase.status === "cancelled"
              ? "cancelled"
              : purchase.transaction_role === "invoice_payment"
                ? "invoice_payment"
                : !date
                  ? "invalid_date"
                  : !inCycle
                    ? "outside_cycle"
                    : purchase.review_status === "pending"
                      ? "awaiting_review"
                      : "unsupported";
          return { purchase, reason };
        }),
    ];
    const instrumentTotals=(card.credit_card_instruments??[]).map(instrument=>{const rows=cardPurchases.filter(purchase=>purchase.instrument_id===instrument.id);const values=calculateInvoiceAmounts(rows);return {instrumentId:instrument.id,lastFour:instrument.last_four_digits,cardKind:instrument.card_kind,displayName:instrument.display_name,grossTotal:values.purchasesTotal,creditsTotal:values.creditsTotal,adjustmentsTotal:values.adjustmentsTotal,netTotal:values.invoiceTotal,purchaseCount:values.purchaseCount,responsiblePersonId:instrument.payment_responsible_person_id??null,responsiblePersonName:instrument.payment_responsible_person?.name??null}});
    const instrumentsTotal=instrumentTotals.reduce((sum,item)=>sum+item.netTotal,0);
    const unassigned=cardPurchases.filter(purchase=>!purchase.instrument_id);
    const unassignedConsumption=unassigned.filter(purchase=>purchase.transaction_role==="consumption"&&purchase.status!=="cancelled");
    const unassignedValues=calculateInvoiceAmounts(unassigned);
    const unassignedTotal=calculateInvoiceAmounts(unassignedConsumption).invoiceTotal;
    const generalAdjustmentsTotal=unassignedValues.invoiceTotal-unassignedTotal;
    const providerInvoiceTotal = !providerBillMatchesCycle
      ? null
      :
      card.provider_invoice_total === null ||
      card.provider_invoice_total === undefined
        ? null
        : amount(card.provider_invoice_total);
    const accountCreditBalance =
      card.account_credit_balance === null ||
      card.account_credit_balance === undefined
        ? null
        : amount(card.account_credit_balance);
    const manualConfirmation=cycle
      ? card.card_invoice_confirmations?.find(confirmation=>confirmation.reference_month.slice(0,7)===cycle.referenceMonth)
      : undefined;
    const manualInvoiceTotal=manualConfirmation
      ? amount(manualConfirmation.official_amount)
      : partial&&storedInvoice?.manual_invoice_total!==null&&
          storedInvoice?.manual_invoice_total!==undefined
        ? amount(storedInvoice.manual_invoice_total)
        : null;
    const confirmedInvoiceTotal=
      partial&&storedInvoice?.confirmed_invoice_total!==null&&
      storedInvoice?.confirmed_invoice_total!==undefined
        ? amount(storedInvoice.confirmed_invoice_total)
        : null;
    const reliableStoredTotal=partial&&storedTotalReliable
      ? storedCalculated
      : null;
    // Account.balance can be an aggregate shared by multiple CREDIT products in
    // some connectors. Keep it for diagnostics, but never promote it to the
    // invoice headline unless the provider exposes an explicitly scoped Bill.
    const totalSource=providerInvoiceTotal!==null
      ? "provider_bill" as const
      : manualInvoiceTotal!==null||confirmedInvoiceTotal!==null
        ? "manual_bank_confirmation" as const
      : "calculated_transactions" as const;
    const officialInvoiceTotal=providerInvoiceTotal??manualInvoiceTotal??
      confirmedInvoiceTotal??(reliableTotalUsed?reliableStoredTotal:null)??
      totals.invoiceTotal;
    const thirdPartyResponsibleTotal=Math.max(0,instrumentTotals
      .filter(item=>item.responsiblePersonId)
      .reduce((sum,item)=>sum+item.netTotal,0));
    const ownerResponsibleTotal=Math.max(0,officialInvoiceTotal-thirdPartyResponsibleTotal);
    const difference =
      totalSource==="calculated_transactions" ? null : officialInvoiceTotal - totals.invoiceTotal;
    const reconciliationStatus =
      totalSource==="calculated_transactions"
        ? "provider_unavailable"
        : Math.abs(difference ?? 0) <= 0.01
          ? "matched"
          : Math.abs(difference ?? 0) <= 1
            ? "small_difference"
            : "divergent";
    const eligiblePurchases=cardPurchases.filter(purchase=>purchase.status!=="cancelled"&&purchase.transaction_role!=="invoice_payment");
    const pendingPurchases=eligiblePurchases.filter(purchase=>purchase.status==="pending");
    const pendingTransactionsTotal=calculateInvoiceAmounts(pendingPurchases).invoiceTotal;
    const postedTransactionsCount=eligiblePurchases.filter(purchase=>purchase.status==="realized").length;
    const withBillIdCount=eligiblePurchases.filter(purchase=>Boolean(purchase.provider_bill_id)).length;
    const withoutBillIdCount=eligiblePurchases.length-withBillIdCount;
    const invoicePaymentsExcludedCount=uniquePurchases.filter(purchase=>purchase.status!=="cancelled"&&purchase.transaction_role==="invoice_payment"&&!cardPurchases.some(item=>item.id===purchase.id)).length;
    const providerUsed = Math.max(0, Number(card.used_limit ?? 0));
    const futureInstallments = purchases
      .filter(
        (purchase) =>
          purchase.card_id === card.id &&
          purchase.status !== "cancelled" &&
          purchase.transaction_role === "consumption" &&
          purchase.is_installment === true &&
          purchase.installment_count !== null &&
          purchase.installment_number !== null &&
          purchase.installment_count > purchase.installment_number,
      )
      .reduce(
        (sum, purchase) =>
          sum +
          amount(persistedCardMovementAmountBrl(purchase)) *
            (Number(purchase.installment_count) - Number(purchase.installment_number)),
        0,
      );
    const committedLimit = Math.max(
      providerUsed,
      officialInvoiceTotal + futureInstallments,
    );
    const limit=card.credit_limit===null||card.credit_limit===undefined
      ? null
      : Math.max(0,Number(card.credit_limit));
    const effectivePaidAmount=storedInvoice?.provider_bill_id
      ? amount(storedInvoice.paid_amount)
      : totals.paidAmount;
    const derivedStatus = deriveInvoiceStatus({
      cycle,
      invoiceTotal: officialInvoiceTotal,
      paidAmount: effectivePaidAmount,
      referenceDate,
    });
    const status=storedInvoice?.payment_status==="paid"
      ? "paid" as const
      : ["partially_paid","installment_payment"].includes(
          storedInvoice?.payment_status??"",
        )
        ? "partially_paid" as const
        : derivedStatus;
    return {
      card,
      cycle,
      purchases: cardPurchases,
      ...totals,
      paidAmount:effectivePaidAmount,
      reliablePurchaseCount:reliableCountUsed?Number(storedPurchaseCount):null,
      invoiceTotal:officialInvoiceTotal,
      outstandingAmount:Math.max(0,officialInvoiceTotal-effectivePaidAmount),
      providerInvoiceTotal,
      manualInvoiceTotal,
      confirmedInvoiceTotal,
      lastReliableInvoiceTotal:reliableStoredTotal,
      lastReliableValueReliable:storedTotalReliable,
      providerValueReliable:providerInvoiceTotal!==null&&!partial,
      calculatedValueReliable:(options.purchaseDataAvailable??true)&&
        (!partial||liveTotals.purchaseCount>0),
      accountCreditBalance,
      calculatedInvoiceTotal: totals.invoiceTotal,
      totalSource,
      pendingTransactionsTotal,
      pendingTransactionsCount:pendingPurchases.length,
      postedTransactionsCount,
      withBillIdCount,
      withoutBillIdCount,
      invoicePaymentsExcludedCount,
      cycleEstimated:card.dates_source==="estimated",
      reconciliationDifference: difference,
      reconciliationStatus,
      committedLimit,
      availableLimit:limit===null?null:Math.max(0,limit-committedLimit),
      usedPercent:limit?Math.min(100,(committedLimit/limit)*100):0,
      isStale: Boolean(
        card.last_sync_at &&
          referenceDate.valueOf() - new Date(card.last_sync_at).valueOf() >
            48 * 60 * 60 * 1000,
      ),
      instrumentTotals,
      thirdPartyResponsibleTotal,
      ownerResponsibleTotal,
      instrumentsTotal,
      unassignedTotal,
      unassignedCount:unassignedConsumption.length,
      generalAdjustmentsTotal,
      excludedItems,
      linkedPayments,
      purchaseDataAvailable: options.purchaseDataAvailable ?? true,
      isPartial:partial,
      reliableSnapshotUsed,
      preservationReason:storedInvoice?.preservation_reason??null,
      lastCompleteSyncAt:storedInvoice?.last_complete_sync_at??
        card.bank_connections?.last_complete_sync_at??null,
      lastAttemptAt:storedInvoice?.last_sync_at??card.last_sync_at,
      officialPayments:storedInvoice?.credit_card_bill_payments??[],
      financeCharges:storedInvoice?.credit_card_bill_finance_charges??[],
      paymentStatus:storedInvoice?.payment_status??null,
      status,
    };
  });
}

export function comparePreviousCycleAtSameStage(
  current: CurrentCardInvoice,
  allPurchases: CardPurchase[],
  referenceDate = new Date(),
) {
  if (!current.cycle) return null;
  const start = new Date(`${current.cycle.cycleStart}T00:00:00Z`);
  const elapsed = Math.max(
    0,
    Math.floor(
      (Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate(),
      ) -
        start.valueOf()) /
        86_400_000,
    ),
  );
  const previousEnd = new Date(start.valueOf() - 86_400_000);
  const previous = getCurrentBillingCycle({
    closingDay: current.card.closing_day!,
    dueDay: current.card.due_day!,
    referenceDate: previousEnd,
  });
  const comparisonEnd = new Date(
    Math.min(
      new Date(`${previous.cycleStart}T00:00:00Z`).valueOf() +
        elapsed * 86_400_000,
      new Date(`${previous.cycleEnd}T00:00:00Z`).valueOf(),
    ),
  )
    .toISOString()
    .slice(0, 10);
  const previousPurchases = allPurchases.filter((purchase) => {
    const date = purchaseCompetenceDate(purchase);
    return (
      purchase.card_id === current.card.id &&
      date >= previous.cycleStart &&
      date <= comparisonEnd
    );
  });
  const previousTotal = calculateInvoiceAmounts(previousPurchases).invoiceTotal;
  const difference = current.calculatedInvoiceTotal - previousTotal;
  return {
    currentTotal: current.calculatedInvoiceTotal,
    previousTotal,
    difference,
    percentage: previousTotal ? (difference / previousTotal) * 100 : null,
    elapsedDays: elapsed + 1,
  };
}
