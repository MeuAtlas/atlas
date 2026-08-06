import type { BankConnectionSummary,CardPurchase,CreditCard,FinancialAccount,FinancialInvestment,FinancialLoan,FinancialTransaction,StoredCardInvoice } from "./types";
import {
  logSupabaseError,
  normalizeSupabaseError,
  throwSupabaseError,
} from "@/lib/errors";
import { requireQuery,withQueryFallback } from "@/lib/supabase/query-fallback";
import { shiftFinanceMonth, type FinanceMonthPeriod } from "./monthly-result";
import {
  decodeInvoiceHistoryCursor,
  discardUndatedRecentStatementPayments,
  encodeInvoiceHistoryCursor,
  HISTORICAL_INVOICE_STATUSES,
  isRecentUnconfirmedProjectableStatement,
  normalizeHistoricalInvoice,
  preferFreshStatementProjection,
  resolveHistoricalInvoiceTotal,
  sortHistoricalInvoices,
  type CreditCardInvoiceHistoryResult,
  type HistoricalInvoiceStatus,
  type InvoiceHistoryAnalyticsEntry,
} from "./invoice-history";
import {
  normalizeAvailableCardCycles,
  restoreConfirmedPdfCycleAxes,
  type AvailableCardCycle,
  type CardCycleRow,
} from "./card-cycles";
import {
  cardPurchaseBelongsToCycle,
  getClosedCardCycleMovements,
  getOpenCardCycleMovements,
  resolveInvoiceEntryEffect,
  type CardCycleMovement,
  type CardCycleMovementEntryType,
} from "./card-cycle-movements";
import {
  resolveCardCycleAccountIds,
  resolveOpenProjectionCardAccountIds,
} from "./card-cycle-accounts";
import {
  openInvoiceCacheTag,
  openInvoiceDifference,
  openInvoiceMoney,
  resolveOpenInvoiceTotal,
  resolvedOpenInvoiceSourceLabel,
  type ResolvedOpenCardInvoice,
} from "./open-card-invoice";
import { calculateOpenCardCycleBreakdown } from "./open-card-cycle";
import { normalizeCardMovementAmounts } from "./foreign-card-movement";
import {
  findCreditCardPaymentCandidates,
  identifyCreditCardPaymentTransaction,
} from "./credit-card-payment-reconciliation";
import {
  buildResolvedCardCycleDetails,
  type ResolvedCardCycleDetails,
} from "./resolved-card-cycle-details";
type Client=Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export async function getAvailableCardCycles(
  supabase: Client,
  userId: string,
  workspaceId: string | null = null,
): Promise<AvailableCardCycle[]> {
  let query = supabase
    .from("card_invoices")
    .select(
      "id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,status,source,document_id,provider_bill_id,official_total,provider_invoice_total,manual_invoice_total,confirmed_invoice_total,confirmed_open_total,confirmed_open_total_at,total_amount,reconciliation_difference,identified_entries_total,credits_total,payments_total,finance_charges_total,previous_balance,last_reliable_invoice_total,current_display_total,data_completeness,credit_cards:credit_cards!card_invoices_card_id_fkey(name,institution_name,last_four_digits)",
    )
    .neq("status", "cancelled");
  query = workspaceId
    ? query.eq("workspace_id", workspaceId).eq("visibility", "workspace")
    : query.eq("owner_id", userId).is("workspace_id", null);
  const result = await query
    .order("cycle_end_date", { ascending: false })
    .limit(60);
  if (result.error) {
    throwSupabaseError(
      result.error,
      "getAvailableCardCycles.card_invoices",
      "Não foi possível carregar os ciclos de fatura disponíveis.",
    );
  }
  const rows = (result.data ?? []) as unknown as CardCycleRow[];
  const documentIds = [...new Set(rows.flatMap(row => row.document_id ? [row.document_id] : []))];
  const documents = documentIds.length
    ? await supabase.from("invoice_documents")
      .select("id,parsed_payload,confirmed_at")
      .eq("user_id", userId)
      .in("id", documentIds)
    : { data: [], error: null };
  if (documents.error) {
    throwSupabaseError(
      documents.error,
      "getAvailableCardCycles.invoice_documents",
      "Não foi possível carregar as datas confirmadas das faturas.",
    );
  }
  return normalizeAvailableCardCycles(
    restoreConfirmedPdfCycleAxes(rows, documents.data ?? []),
  );
}

export const CARD_PURCHASE_SELECT =
  "id,workspace_id,card_id,external_id,instrument_id,instrument_review_status,invoice_id,provider_bill_id,description,total_amount,total_purchase_amount,is_installment,installment_amount,amount_brl,provider_signed_amount,purchase_date,posting_date,competence_date,created_at,installment_number,installment_count,installment_source,installment_confidence,installment_plan_id,installment_manually_confirmed,source,source_type,financial_origin,transaction_role,entry_type,related_foreign_purchase_id,status,review_status,invoice_reference,bill_forecast_date,provider_category,merchant,visibility,category_id,currency,original_amount,original_currency_code,exchange_rate,foreign_iof_amount,conversion_source,conversion_confidence,converted_at,provider_metadata,credit_cards:credit_cards!card_purchases_card_id_fkey(name,institution_name,last_four_digits),credit_card_instruments(last_four_digits,card_kind,display_name),financial_categories:financial_categories!card_purchases_category_id_fkey(name)";

export async function getReliableCurrentInvoiceSnapshots(
  supabase:Client,
  userId:string,
  workspaceId:string|null=null,
){
  let query=supabase.from("card_invoices").select(
    "id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,total_amount,paid_amount,paid_at,outstanding_amount,purchase_count,status,external_id,provider_bill_id,provider_account_id,provider_invoice_total,calculated_invoice_total,manual_invoice_total,confirmed_invoice_total,last_reliable_invoice_total,current_display_total,last_reliable_purchase_count,data_completeness,last_sync_at,last_complete_sync_at,stale_since,provider_status,preservation_reason,minimum_payment_amount,provider_bill_status,payment_status,total_source,reconciliation_difference,reconciliation_status,provider_updated_at,updated_at,invoice_breakdown,credit_card_bill_payments(id,provider_payment_id,value_type,payment_date,payment_mode,amount,currency_code,linked_bank_transaction_id),credit_card_bill_finance_charges(id,provider_charge_id,charge_type,amount,currency_code,additional_info)",
  );
  query=workspaceId
    ? query.eq("workspace_id",workspaceId).eq("visibility","workspace")
    : query.eq("owner_id",userId);
  const result=await query.order("reference_month",{ascending:false}).limit(24);
  if(result.error)throwSupabaseError(
    result.error,
    "carregar snapshots confiáveis de fatura",
    "Não foi possível carregar os últimos valores confiáveis das faturas.",
  );
  return (result.data??[]) as unknown as StoredCardInvoice[];
}

export async function getCreditCardInvoiceAnalyticsEntries(
  supabase: Client,
  userId: string,
  workspaceId: string | null = null,
): Promise<InvoiceHistoryAnalyticsEntry[]> {
  let query = supabase
    .from("card_invoices")
    .select(
      "id,card_id,cycle_start_date,cycle_end_date,closing_date,due_date,status,provider_invoice_total,manual_invoice_total,confirmed_invoice_total,calculated_invoice_total,last_reliable_invoice_total,current_display_total,paid_amount,paid_at,payment_status,confirmed_payment_amount,payment_confirmation_status,payment_confirmation_source,payment_confirmed_at,total_source",
    )
    .neq("status", "cancelled")
    .order("due_date", { ascending: false })
    .limit(60);
  query = workspaceId
    ? query.eq("workspace_id", workspaceId).eq("visibility", "workspace")
    : query.eq("owner_id", userId).is("workspace_id", null);
  const result = await query;
  if (result.error) {
    throwSupabaseError(
      result.error,
      "carregar análise histórica de faturas",
      "Não foi possível calcular o histórico de consumo dos cartões.",
    );
  }
  const statementIds = (result.data ?? []).map(row => String(row.id));
  const paymentsResult = statementIds.length
    ? await supabase.from("credit_card_statement_payments")
        .select("statement_id,bank_transaction_id,payment_date,allocated_amount,is_third_party,payment_source")
        .in("statement_id", statementIds)
    : { data: [], error: null };
  const officialPaymentsResult = statementIds.length
    ? await supabase.from("credit_card_bill_payments")
        .select("bill_id,value_type")
        .in("bill_id", statementIds)
    : { data: [], error: null };
  const officialPartialStatementIds = new Set(
    (officialPaymentsResult.data ?? []).flatMap(payment =>
      String(payment.value_type) === "INSTALLMENT_PAYMENT"
        ? [String(payment.bill_id)]
        : []),
  );
  const paymentsByStatement = new Map<string, Array<{
    payment_date: string;
    bank_transaction_id: string | null;
    allocated_amount: number | string;
    is_third_party: boolean;
    payment_source: string;
  }>>();
  if (!paymentsResult.error) {
    for (const payment of paymentsResult.data ?? []) {
      const key = String(payment.statement_id);
      const list = paymentsByStatement.get(key) ?? [];
      list.push(payment as typeof list[number]);
      paymentsByStatement.set(key, list);
    }
  }
  const allocatedTransactionIds = new Set(
    [...paymentsByStatement.values()].flatMap(payments =>
      payments.flatMap(payment => payment.bank_transaction_id
        ? [payment.bank_transaction_id]
        : []),
    ),
  );
  const explicitPartialTransactionIds = new Set<string>();
  const earliestClosingDate = (result.data ?? [])
    .flatMap(row => row.closing_date ? [String(row.closing_date).slice(0, 10)] : [])
    .sort()[0];
  if (earliestClosingDate) {
    let fallbackQuery = supabase.from("financial_transactions").select(
      "id,description,amount,original_amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,source,visibility,account_id,credit_card_id,invoice_id,workspace_id",
    ).eq("owner_id", userId)
      .not("account_id", "is", null)
      .or("transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment,financial_nature.eq.invoice_payment")
      .gte("competence_date", earliestClosingDate)
      .order("competence_date", { ascending: true })
      .limit(120);
    fallbackQuery = workspaceId
      ? fallbackQuery.eq("workspace_id", workspaceId)
      : fallbackQuery.is("workspace_id", null);
    const fallbackPayments = await fallbackQuery;
    if (!fallbackPayments.error) {
      const statements = (result.data ?? []).map(row => {
        const resolved = resolveHistoricalInvoiceTotal(row as Pick<
          StoredCardInvoice,
          | "provider_invoice_total"
          | "manual_invoice_total"
          | "confirmed_invoice_total"
          | "calculated_invoice_total"
          | "total_source"
        >);
        return {
          id: String(row.id),
          cardId: String(row.card_id),
          expectedAmount: Number(resolved.total ?? row.current_display_total ?? 0),
          closingDate: String(row.closing_date),
          dueDate: String(row.due_date),
          cancelled: String(row.status) === "cancelled",
        };
      });
      for (const rawPayment of fallbackPayments.data ?? []) {
        const payment = rawPayment as unknown as FinancialTransaction;
        if (/(PARCIAL|MINIM[OA]|FINANCI|ROTATIV)/i.test(payment.description)) {
          explicitPartialTransactionIds.add(payment.id);
          continue;
        }
        if (allocatedTransactionIds.has(payment.id)) continue;
        const identified = identifyCreditCardPaymentTransaction(payment);
        if (!identified.isCandidate || !identified.paymentDate || identified.amount <= 0) continue;
        const eligibleStatements = statements.filter(statement =>
          !(paymentsByStatement.get(statement.id)?.length) &&
          identified.paymentDate! > statement.closingDate.slice(0, 10) &&
          identified.paymentDate! <= statement.dueDate.slice(0, 10),
        );
        const candidates = findCreditCardPaymentCandidates({
          transaction: payment,
          statements: eligibleStatements,
        });
        const best = candidates[0];
        if (!best || best.score < 50 || candidates[1]?.score === best.score) continue;
        const list = paymentsByStatement.get(best.statementId) ?? [];
        list.push({
          payment_date: identified.paymentDate,
          bank_transaction_id: payment.id,
          allocated_amount: identified.amount,
          is_third_party: false,
          payment_source: "bank_transaction",
        });
        paymentsByStatement.set(best.statementId, list);
        allocatedTransactionIds.add(payment.id);
      }
    }
  }
  const entries = (result.data ?? []).flatMap(row => {
    const status = String(row.status) as StoredCardInvoice["status"];
    const payments = paymentsByStatement.get(String(row.id)) ?? [];
    const confirmedPaymentAmount = Number(row.confirmed_payment_amount ?? 0);
    const legacyPaidAmount = Number(row.paid_amount ?? 0);
    const paidAmount = confirmedPaymentAmount > 0
      ? confirmedPaymentAmount
      : payments.length
        ? payments.reduce((sum, payment) => sum + Math.abs(Number(payment.allocated_amount ?? 0)), 0)
        : legacyPaidAmount;
    const paymentDate = payments.map(payment => payment.payment_date).sort().at(-1) ??
      (row.payment_confirmed_at ? String(row.payment_confirmed_at).slice(0, 10) : null) ??
      (row.paid_at ? String(row.paid_at).slice(0, 10) : null);
    const resolved = resolveHistoricalInvoiceTotal(
      row as Pick<
        StoredCardInvoice,
        | "provider_invoice_total"
        | "manual_invoice_total"
        | "confirmed_invoice_total"
        | "calculated_invoice_total"
        | "total_source"
      >,
    );
    const paymentStatus = row.payment_status ? String(row.payment_status) : null;
    const rawConfirmation = row.payment_confirmation_status
      ? String(row.payment_confirmation_status)
      : null;
    const explicitPartialPayment = officialPartialStatementIds.has(String(row.id)) ||
      payments.some(payment => payment.bank_transaction_id &&
        explicitPartialTransactionIds.has(payment.bank_transaction_id));
    const bankPaymentConfirmsHistory = paidAmount > 0 && status !== "open" &&
      !explicitPartialPayment;
    const effectiveConfirmation = ["paid", "overpaid", "manually_confirmed"]
      .includes(rawConfirmation ?? "")
      ? rawConfirmation
      : status === "paid" || paymentStatus === "paid" || bankPaymentConfirmsHistory
        ? "paid"
        : rawConfirmation;
    return [{
      id: String(row.id),
      cardId: String(row.card_id),
      cycleStartDate: row.cycle_start_date ? String(row.cycle_start_date) : null,
      cycleEndDate: row.cycle_end_date ? String(row.cycle_end_date) : null,
      closingDate: row.closing_date ? String(row.closing_date) : null,
      dueDate: String(row.due_date),
      paymentDate,
      status,
      total: status === "open" && Number(row.current_display_total ?? 0) > 0
        ? Number(row.current_display_total)
        : resolved.total,
      reliableTotal: row.last_reliable_invoice_total == null ? null : Number(row.last_reliable_invoice_total),
      estimatedTotal: row.calculated_invoice_total == null ? null : Number(row.calculated_invoice_total),
      paidAmount: paidAmount > 0 ? paidAmount : null,
      paymentConfirmationStatus: effectiveConfirmation,
      paymentConfirmationSource: row.payment_confirmation_source
        ? String(row.payment_confirmation_source)
        : bankPaymentConfirmsHistory ? "bank_transaction" : null,
      paymentStatus,
      explicitPartialPayment,
      isConfirmed: ["paid", "manually_confirmed", "overpaid"].includes(effectiveConfirmation ?? ""),
      totalSource: resolved.source,
    }];
  });
  const cleanedEntries = discardUndatedRecentStatementPayments(entries);
  const projectedTotals = new Map<string, number>();
  await Promise.all(cleanedEntries.map(async entry => {
    if (
      !isRecentUnconfirmedProjectableStatement(entry) ||
      !entry.cycleStartDate ||
      !entry.cycleEndDate
    ) return;
    try {
      const movements = await getMovementsData(supabase, userId, {
        from: entry.cycleStartDate,
        to: entry.cycleEndDate,
        type: "card",
        cycleId: entry.id,
      });
      const breakdown = calculateOpenCardCycleBreakdown({
        movements: movements.cardPurchases.map(purchase => ({
          id: purchase.id,
          amount: Math.abs(Number(purchase.amount_brl) || 0),
          effect:
            purchase.transaction_role === "refund" ||
            Number(purchase.installment_amount) < 0
              ? "credit" as const
              : "debit" as const,
          entryType: purchase.entry_type,
          source: purchase.source,
          reconciliationStatus: purchase.reconciliation_status,
          installmentNumber: purchase.installment_number,
          installmentTotal: purchase.installment_count,
          description: purchase.description,
          cardId: purchase.card_id,
          competenceMonth: purchase.competence_month,
        })),
        confirmedOpenTotal: null,
        installmentsDataStatus: movements.installmentsDataStatus,
      });
      if (breakdown.detailedTotal > 0) {
        projectedTotals.set(entry.id, breakdown.detailedTotal);
      }
    } catch {
      // Preserve the stored snapshot when live movement details are unavailable.
    }
  }));
  return cleanedEntries.map(entry =>
    preferFreshStatementProjection(
      entry,
      projectedTotals.get(entry.id) ?? null,
    ));
}

export async function getCardInvoiceHistory(
  supabase: Client,
  userId: string,
  cardId: string,
) {
  const result = await supabase
    .from("card_invoices")
    .select(
      "id,document_id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,total_amount,paid_amount,paid_at,outstanding_amount,purchase_count,status,external_id,provider_invoice_total,calculated_invoice_total,manual_invoice_total,confirmed_invoice_total,minimum_payment_amount,provider_bill_status,total_source,reconciliation_difference,reconciliation_status,provider_updated_at,invoice_breakdown,details_status,pluggy_bill_total_amount,pdf_total_amount,manual_total_amount,confirmed_total_amount,confirmed_total_source,payment_confirmation_status,confirmed_payment_amount,invoice_entries(id,transaction_date,description_raw,amount,entry_type,card_last_four,installment_number,installment_total,confidence,provider_transaction_id)",
    )
    .eq("owner_id", userId)
    .eq("card_id", cardId)
    .order("cycle_end_date", { ascending: false });
  if (result.error) {
    throwSupabaseError(
      result.error,
      "carregar histórico de faturas",
      "Não foi possível carregar o histórico deste cartão.",
    );
  }
  return (result.data ?? []) as StoredCardInvoice[];
}

export async function getCreditCardInvoiceHistory(
  supabase: Client,
  userId: string,
  options: {
    workspaceId?: string | null;
    cardId?: string;
    year?: number;
    status?: HistoricalInvoiceStatus;
    periodStart?: string;
    periodEnd?: string;
    cursor?: string | null;
    limit?: number;
  } = {},
): Promise<CreditCardInvoiceHistoryResult> {
  const limit = Math.min(24, Math.max(1, options.limit ?? 12));
  const offset = decodeInvoiceHistoryCursor(options.cursor);
  const today = new Date().toISOString().slice(0, 10);
  const allowedStatuses = options.status
    ? [options.status]
    : [...HISTORICAL_INVOICE_STATUSES];
  let invoicesQuery = supabase
    .from("card_invoices")
    .select(
      "id,document_id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,total_amount,paid_amount,paid_at,outstanding_amount,purchase_count,status,external_id,provider_invoice_total,calculated_invoice_total,manual_invoice_total,confirmed_invoice_total,minimum_payment_amount,provider_bill_status,total_source,reconciliation_difference,reconciliation_status,provider_updated_at,invoice_breakdown,details_status,pluggy_bill_total_amount,pdf_total_amount,manual_total_amount,confirmed_total_amount,confirmed_total_source,payment_confirmation_status,confirmed_payment_amount,invoice_entries(id,transaction_date,description_raw,amount,entry_type,card_last_four,installment_number,installment_total,confidence,provider_transaction_id)",
      { count: "exact" },
    )
    .in("status", allowedStatuses)
    .lt("closing_date", today)
    .order("due_date", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.workspaceId) {
    invoicesQuery = invoicesQuery
      .eq("workspace_id", options.workspaceId)
      .eq("visibility", "workspace");
  } else {
    invoicesQuery = invoicesQuery.eq("owner_id", userId).is("workspace_id", null);
  }
  if (options.cardId) invoicesQuery = invoicesQuery.eq("card_id", options.cardId);
  if (options.year) {
    invoicesQuery = invoicesQuery
      .gte("due_date", `${options.year}-01-01`)
      .lte("due_date", `${options.year}-12-31`);
  } else {
    if (options.periodStart) {
      invoicesQuery = invoicesQuery.gte("due_date", options.periodStart);
    }
    if (options.periodEnd) {
      invoicesQuery = invoicesQuery.lte("due_date", options.periodEnd);
    }
  }

  const invoiceResult = await invoicesQuery;
  if (invoiceResult.error) {
    throwSupabaseError(
      invoiceResult.error,
      "carregar faturas anteriores",
      "NÃ£o foi possÃ­vel carregar as faturas anteriores.",
    );
  }
  const storedInvoices = (invoiceResult.data ?? []) as StoredCardInvoice[];
  if (!storedInvoices.length) {
    return {
      invoices: [],
      nextCursor: null,
      totalCount: invoiceResult.count ?? 0,
      warnings: [],
      dataCompleteness: "complete",
    };
  }

  const invoiceIds = storedInvoices.map((invoice) => invoice.id);
  const cardIds = [...new Set(storedInvoices.map((invoice) => invoice.card_id))];
  const earliestClosingDate = storedInvoices
    .map((invoice) => invoice.closing_date)
    .sort()[0];
  const latestDueDate = storedInvoices
    .map((invoice) => invoice.due_date)
    .sort()
    .at(-1)!;
  let cardsQuery = supabase
    .from("credit_cards")
    .select(
      "id,workspace_id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source",
    )
    .in("id", cardIds);
  let purchasesQuery = supabase
    .from("card_purchases")
    .select(CARD_PURCHASE_SELECT)
    .in("invoice_id", invoiceIds)
    .order("purchase_date", { ascending: false })
    .limit(2000);
  let paymentsQuery = supabase
    .from("financial_transactions")
    .select(
      "id,description,amount,transaction_type,transaction_role,source_type,financial_origin,bank_direction,status,competence_date,due_date,realized_at,source,visibility,account_id,credit_card_id,invoice_id,destination_account_id,category_id,workspace_id,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)",
    )
    .eq("source_type", "bank")
    .or("transaction_role.eq.invoice_payment,description.ilike.%PAGAMENTO%")
    .gte("competence_date", earliestClosingDate)
    .lte("competence_date", latestDueDate)
    .limit(100);
  if (options.workspaceId) {
    cardsQuery = cardsQuery.eq("workspace_id", options.workspaceId).eq("visibility", "workspace");
    purchasesQuery = purchasesQuery.eq("workspace_id", options.workspaceId).eq("visibility", "workspace");
    paymentsQuery = paymentsQuery.eq("workspace_id", options.workspaceId).eq("visibility", "workspace");
  } else {
    cardsQuery = cardsQuery.eq("owner_id", userId).is("workspace_id", null);
    purchasesQuery = purchasesQuery.eq("owner_id", userId).is("workspace_id", null);
    paymentsQuery = paymentsQuery.eq("owner_id", userId).is("workspace_id", null);
  }

  const [cardsResult, purchasesResult, paymentsResult] = await Promise.all([
    cardsQuery,
    purchasesQuery,
    paymentsQuery,
  ]);
  if (cardsResult.error) {
    throwSupabaseError(
      cardsResult.error,
      "carregar cartÃµes das faturas",
      "NÃ£o foi possÃ­vel identificar os cartÃµes das faturas.",
    );
  }
  const warnings: string[] = [];
  if (purchasesResult.error) warnings.push("Compras do histÃ³rico parcialmente indisponÃ­veis.");
  if (paymentsResult.error) warnings.push("Pagamentos do histÃ³rico parcialmente indisponÃ­veis.");
  const cards = (cardsResult.data ?? []) as unknown as CreditCard[];
  const purchases = purchasesResult.error
    ? []
    : (purchasesResult.data ?? []) as unknown as CardPurchase[];
  const payments = paymentsResult.error
    ? []
    : (paymentsResult.data ?? []) as unknown as FinancialTransaction[];
  const cardMap = new Map(cards.map((card) => [card.id, card]));
  const invoices = storedInvoices.flatMap((invoice) => {
    const card = cardMap.get(invoice.card_id);
    return card
      ? [
          normalizeHistoricalInvoice({
            invoice,
            card,
            purchases,
            payments,
          }),
        ]
      : [];
  });
  const totalCount = invoiceResult.count ?? invoices.length;
  return {
    invoices: sortHistoricalInvoices(invoices),
    nextCursor:
      offset + storedInvoices.length < totalCount
        ? encodeInvoiceHistoryCursor(offset + storedInvoices.length)
        : null,
    totalCount,
    warnings,
    dataCompleteness: warnings.length ? "partial" : "complete",
  };
}

export async function getFinanceOverviewData(
 supabase:Client,
 userId:string,
 options:{period:FinanceMonthPeriod;workspaceId?:string|null},
){
 const historyStart=shiftFinanceMonth(options.period,-5).startDate;
 const workspaceId=options.workspaceId??null;
 let accountsQuery=supabase.from("financial_accounts").select("id,workspace_id,bank_connection_id,name,institution_name,account_type,current_balance,opening_balance,source,status,visibility,last_sync_at").order("created_at");
 let transactionsQuery=supabase.from("financial_transactions").select("id,external_id,description,amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,provider_type,operation_type,operation_type_additional_info,classification_source,classification_confidence,classification_rule,classification_version,manually_confirmed,manual_override_at,manual_override_by,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,date_source,date_confidence,date_override_reason,created_at,source,visibility,account_id,credit_card_id,invoice_id,loan_id,recurring_rule_id,payment_source,transfer_group_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").gte("competence_date",historyStart).order("competence_date",{ascending:false}).limit(1200);
 let purchasesQuery=supabase.from("card_purchases").select(CARD_PURCHASE_SELECT).or(`competence_date.gte.${historyStart},and(competence_date.is.null,purchase_date.gte.${historyStart})`).order("purchase_date",{ascending:false}).limit(2000);
 let cardsQuery=supabase.from("credit_cards").select("id,workspace_id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source,credit_card_instruments(id,credit_card_id,external_id,last_four_digits,card_kind,display_name,provider_status,user_archived_at,source,payment_responsible_person_id,payment_responsible_person:financial_people!credit_card_instruments_payment_responsible_person_id_fkey(id,name)),card_invoice_confirmations(id,card_id,reference_month,official_amount,source,informed_at,note)").order("created_at");
 if(workspaceId){
  accountsQuery=accountsQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
  transactionsQuery=transactionsQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
  purchasesQuery=purchasesQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
  cardsQuery=cardsQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
 }else{
  accountsQuery=accountsQuery.eq("owner_id",userId).is("workspace_id",null);
  transactionsQuery=transactionsQuery.eq("owner_id",userId).is("workspace_id",null);
  purchasesQuery=purchasesQuery.eq("owner_id",userId).is("workspace_id",null);
  cardsQuery=cardsQuery.eq("owner_id",userId).is("workspace_id",null);
 }
 const [accounts,transactions,cardPurchases,cards,connections]=await Promise.all([
  requireQuery("financial_accounts",accountsQuery),
  requireQuery("financial_transactions",transactionsQuery),
  withQueryFallback("dashboard_card_purchases",purchasesQuery,[]),
  withQueryFallback("dashboard_credit_cards",cardsQuery,[]),
  withQueryFallback("dashboard_provider_health",supabase.from("bank_connections").select("id,connector_name,sync_status,last_successful_sync_at,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count,loans_sync_status,loans_sync_message,last_loans_sync_at").eq("owner_id",userId).eq("provider","pluggy").neq("status","disabled").order("last_successful_sync_at",{ascending:false}),[]),
 ]);
 const connectionRows=connections.data as BankConnectionSummary[];
 const connectionMap=new Map(connectionRows.map(connection=>[String(connection.id),connection]));
 const cardRows=(cards.data as unknown as CreditCard[]).map(card=>{const connection=card.bank_connection_id?connectionMap.get(card.bank_connection_id):undefined;return {...card,bank_connections:connection?{last_complete_sync_at:connection.last_complete_sync_at??null,data_completeness:connection.data_completeness??"unknown",provider_status:connection.provider_status??"waiting"}:null}});
 return {accounts:accounts as FinancialAccount[],transactions:transactions as unknown as FinancialTransaction[],cardPurchases:cardPurchases.data as unknown as CardPurchase[],cards:cardRows,connections:connectionRows,warnings:{cardPurchases:Boolean(cardPurchases.warning),cards:Boolean(cards.warning),connections:Boolean(connections.warning)}};
}

export async function getFinanceProjectionCardData(supabase:Client,userId:string,workspaceId:string|null=null){
 let purchasesQuery=supabase.from("card_purchases").select(CARD_PURCHASE_SELECT);
 let cardsQuery=supabase.from("credit_cards").select("id,external_id,workspace_id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source,credit_card_instruments(id,credit_card_id,external_id,last_four_digits,card_kind,display_name,provider_status,user_archived_at,source,payment_responsible_person_id,payment_responsible_person:financial_people!credit_card_instruments_payment_responsible_person_id_fkey(id,name)),card_invoice_confirmations(id,card_id,reference_month,official_amount,source,informed_at,note)");
 if(workspaceId){
  purchasesQuery=purchasesQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
  cardsQuery=cardsQuery.eq("workspace_id",workspaceId).eq("visibility","workspace");
 }else{
  purchasesQuery=purchasesQuery.eq("owner_id",userId);
  cardsQuery=cardsQuery.eq("owner_id",userId);
 }
 const [purchases,cards]=await Promise.all([
  withQueryFallback("projection_card_purchases",purchasesQuery.order("purchase_date",{ascending:false}).limit(2000),[]),
  withQueryFallback("projection_credit_cards",cardsQuery.order("created_at"),[]),
 ]);
 return {cardPurchases:purchases.data as unknown as CardPurchase[],cards:cards.data as unknown as CreditCard[],partial:Boolean(purchases.warning||cards.warning)};
}

export async function getBankAccountMonthlyTransactions(
 supabase:Client,
 userId:string,
 options:{accountId:string;period:FinanceMonthPeriod;workspaceId?:string|null},
){
 const {accountId,period}=options;
 const workspaceId=options.workspaceId??null;
 const effectiveDates=`and(realized_at.gte.${period.startInstant},realized_at.lt.${period.endExclusiveInstant}),and(realized_at.is.null,competence_date.gte.${period.startDate},competence_date.lt.${period.endExclusiveDate})`;
 let query=supabase.from("financial_transactions")
  .select("id,external_id,description,amount,original_amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,classification_source,classification_confidence,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,date_source,date_confidence,date_override_reason,created_at,source,visibility,account_id,credit_card_id,invoice_id,loan_id,recurring_rule_id,payment_source,transfer_group_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_categories:financial_categories!financial_transactions_category_id_fkey(name)")
  .or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment")
  .or(`account_id.eq.${accountId},destination_account_id.eq.${accountId}`)
  .or(effectiveDates)
  .in("status",["realized","completed","posted","settled","paid","received","pending","partial"])
  .order("competence_date",{ascending:true})
  .limit(2000);
 if(workspaceId){
  query=query.eq("workspace_id",workspaceId).eq("visibility","workspace");
 }else{
  query=query.eq("owner_id",userId).is("workspace_id",null);
 }
 return requireQuery(
  "bank_account_monthly_transactions",
  query,
 ) as unknown as Promise<FinancialTransaction[]>;
}

export type MovementUnavailableSource =
  | "card_purchases"
  | "invoice_entries"
  | "card_installment_occurrences"
  | "credit_cards"
  | "financial_categories"
  | "bank_connections";

export type MovementSourceWarning = {
  source: MovementUnavailableSource;
  message: string;
  code?: string;
};

type MovementSourceResult = {
  data: unknown[] | null;
  error: unknown | null;
};

export function resolveMovementSourceResults(input: {
  accounts: MovementSourceResult;
  transactions: MovementSourceResult;
  cardPurchases: MovementSourceResult;
  cards: MovementSourceResult;
  categories: MovementSourceResult;
  connections: MovementSourceResult;
}) {
  if (input.accounts.error) {
    throwSupabaseError(
      input.accounts.error,
      "getMovementsData.financial_accounts",
      "Não foi possível carregar as contas bancárias.",
    );
  }
  if (input.transactions.error) {
    throwSupabaseError(
      input.transactions.error,
      "getMovementsData.financial_transactions",
      "Não foi possível carregar as movimentações bancárias.",
    );
  }

  const warnings: MovementSourceWarning[] = [];
  const unavailableSources: MovementUnavailableSource[] = [];
  const optionalSources = [
    {
      key: "cardPurchases" as const,
      source: "card_purchases" as const,
      message: "Compras de cartão temporariamente indisponíveis.",
    },
    {
      key: "cards" as const,
      source: "credit_cards" as const,
      message: "Detalhes de cartões temporariamente indisponíveis.",
    },
    {
      key: "categories" as const,
      source: "financial_categories" as const,
      message: "Categorias temporariamente indisponíveis.",
    },
    {
      key: "connections" as const,
      source: "bank_connections" as const,
      message: "Status das conexões temporariamente indisponível.",
    },
  ];
  for (const optional of optionalSources) {
    const error = input[optional.key].error;
    if (!error) continue;
    const context = `getMovementsData.${optional.source}`;
    logSupabaseError(error, context);
    const normalized = normalizeSupabaseError(error, context);
    unavailableSources.push(optional.source);
    warnings.push({
      source: optional.source,
      message: optional.message,
      ...(normalized.code ? { code: normalized.code } : {}),
    });
  }

  return {
    accounts: (input.accounts.data ?? []) as FinancialAccount[],
    transactions: (input.transactions.data ?? []) as unknown as FinancialTransaction[],
    cardPurchases: (input.cardPurchases.error
      ? []
      : input.cardPurchases.data ?? []) as unknown as CardPurchase[],
    cards: (input.cards.error
      ? []
      : input.cards.data ?? []) as unknown as CreditCard[],
    categories: (input.categories.error
      ? []
      : input.categories.data ?? []) as Array<{
        id: string;
        name: string;
        type: string;
      }>,
    connections: (input.connections.error
      ? []
      : input.connections.data ?? []) as BankConnectionSummary[],
    completeness: unavailableSources.length ? "partial" as const : "complete" as const,
    unavailableSources,
    warnings,
  };
}

export async function getMovementsData(
  supabase: Client,
  userId: string,
  scope: {
    from: string;
    to: string;
    type?: "all" | "bank" | "card" | "transfer" | "adjustment";
    cycleId?: string;
  },
) {
  const isCardScope = scope.type === "card";
  let period = { from: scope.from, to: scope.to };
  type SelectedMovementCycle = {
    id: string;
    card_id: string;
    reference_month: string;
    cycle_start_date: string;
    cycle_end_date: string;
    closing_date: string | null;
    due_date: string | null;
    status: string;
    source: string;
    document_id: string | null;
    provider_bill_id: string | null;
    official_total: number | string | null;
    provider_invoice_total: number | string | null;
    manual_invoice_total: number | string | null;
    confirmed_invoice_total: number | string | null;
    data_completeness: string | null;
  };
  let selectedCycle: SelectedMovementCycle | null = null;
  if (isCardScope && scope.cycleId) {
    const cycle = await supabase
      .from("card_invoices")
      .select("id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,status,source,document_id,provider_bill_id,official_total,provider_invoice_total,manual_invoice_total,confirmed_invoice_total,data_completeness")
      .eq("owner_id", userId)
      .eq("id", scope.cycleId)
      .maybeSingle();
    if (cycle.error) {
      throwSupabaseError(
        cycle.error,
        "getMovementsData.card_cycle",
        "Não foi possível carregar o ciclo selecionado.",
      );
    }
    if (cycle.data?.cycle_start_date && cycle.data?.cycle_end_date) {
      let restoredCycle = cycle.data as SelectedMovementCycle;
      if (restoredCycle.document_id) {
        const document = await supabase.from("invoice_documents")
          .select("id,parsed_payload,confirmed_at")
          .eq("id", restoredCycle.document_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (document.error) {
          throwSupabaseError(
            document.error,
            "getMovementsData.invoice_document",
            "Não foi possível carregar as datas confirmadas da fatura.",
          );
        }
        restoredCycle = restoreConfirmedPdfCycleAxes(
          [restoredCycle as unknown as CardCycleRow],
          document.data ? [document.data] : [],
        )[0] as unknown as SelectedMovementCycle;
      }
      selectedCycle = restoredCycle;
      period = {
        from: selectedCycle.cycle_start_date,
        to: selectedCycle.cycle_end_date,
      };
    }
  }

  const isPdfCycle = Boolean(
    selectedCycle?.document_id || selectedCycle?.source === "pdf",
  );
  const cutoffGraceFrom = (() => {
    const date = new Date(`${period.from}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 2);
    return date.toISOString().slice(0, 10);
  })();
  const isOpenCycle = Boolean(
    selectedCycle &&
    ["open", "partial"].includes(selectedCycle.status) &&
    !isPdfCycle,
  );
  const isClosedWithoutPdf = Boolean(
    selectedCycle && !isOpenCycle && !isPdfCycle,
  );
  const openProjectionCyclesResult = isOpenCycle
    ? await supabase
      .from("card_invoices")
      .select("card_id,cycle_start_date,cycle_end_date,status,document_id,source")
      .eq("owner_id", userId)
      .in("status", ["open", "partial"])
      .is("document_id", null)
    : { data: [], error: null };
  if (openProjectionCyclesResult.error) {
    throwSupabaseError(
      openProjectionCyclesResult.error,
      "getMovementsData.open_projection_cycles",
      "Não foi possível identificar os cartões da projeção aberta.",
    );
  }
  const openProjectionCardIds = Array.isArray(openProjectionCyclesResult.data)
    ? openProjectionCyclesResult.data
      .map(cycle => String(cycle.card_id))
      .filter(Boolean)
    : [];
  const cardsResult = await supabase
    .from("credit_cards")
    .select("id,external_id,bank_connection_id,name,institution_name,last_four_digits,status,user_archived_at,credit_card_instruments(id,last_four_digits,display_name,card_kind,user_archived_at)")
    .eq("owner_id", userId)
    .order("created_at");
  if (isCardScope && cardsResult.error) {
    throwSupabaseError(
      cardsResult.error,
      "getMovementsData.credit_cards",
      "Não foi possível resolver as contas de cartão deste ciclo.",
    );
  }
  const cycleAccountResolution = selectedCycle
    ? (isOpenCycle
      ? resolveOpenProjectionCardAccountIds
      : resolveCardCycleAccountIds)(
      selectedCycle.card_id,
      (cardsResult.data ?? []) as unknown as CreditCard[],
    )
    : null;
  const cycleCardIds = [...new Set([
    ...(cycleAccountResolution?.cardIds ??
      (selectedCycle ? [selectedCycle.card_id] : [])),
    ...openProjectionCardIds,
  ])];
  const transactionSelect = "id,external_id,description,amount,amount_brl,original_amount,original_currency,original_currency_code,exchange_rate,foreign_iof_amount,conversion_source,converted_at,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,provider_category,classification_source,classification_confidence,manually_confirmed,manual_override_at,status,competence_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,created_at,source,account_id,credit_card_id,invoice_id,payment_source,transfer_group_id,destination_account_id,category_id,review_status,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)";
  const purchaseSelect = "id,external_id,provider_bill_id,description,total_amount,installment_amount,amount_brl,provider_signed_amount,installment_number,installment_count,purchase_date,posting_date,competence_date,created_at,source,source_type,financial_origin,transaction_role,entry_type,related_foreign_purchase_id,status,review_status,instrument_id,instrument_review_status,provider_category,merchant,currency,original_amount,original_currency_code,exchange_rate,foreign_iof_amount,conversion_source,conversion_confidence,converted_at,provider_metadata,card_id,invoice_id,invoice_reference,bill_forecast_date,category_id,credit_cards:credit_cards!card_purchases_card_id_fkey(name,institution_name,last_four_digits),credit_card_instruments:credit_card_instruments!card_purchases_instrument_id_fkey(display_name,last_four_digits,card_kind),financial_categories:financial_categories!card_purchases_category_id_fkey(name)";
  const emptyResult = Promise.resolve({ data: [], error: null });
  const transactionsQuery = isCardScope
    ? selectedCycle && isOpenCycle
      ? supabase
        .from("financial_transactions")
        .select(transactionSelect)
        .eq("owner_id", userId)
        .eq("source", "pluggy")
        .in("credit_card_id", cycleCardIds)
        .gte("competence_date", period.from)
        .lte("competence_date", period.to)
        .order("competence_date", { ascending: false })
        .limit(800)
      : emptyResult
    : supabase
      .from("financial_transactions")
      .select(transactionSelect)
      .eq("owner_id", userId)
      .or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment")
      .gte("competence_date", period.from)
      .lte("competence_date", period.to)
      .order("competence_date", { ascending: false })
      .limit(400);
  const purchasesQuery = (async () => {
    if (isCardScope && !selectedCycle) return emptyResult;
    // A closed statement has exactly one detail source: its confirmed PDF.
    // Pluggy's Bill remains authoritative for the total, not for list rows.
    if (isCardScope && (isPdfCycle || isClosedWithoutPdf)) return emptyResult;
    const baseQuery = () => supabase
      .from("card_purchases")
      .select(purchaseSelect)
      .eq("owner_id", userId)
      .eq("source", "pluggy");
    if (isCardScope && selectedCycle) {
      const forCycle = () => baseQuery().in("card_id", cycleCardIds);
      const candidateQueries = [
        forCycle().eq("invoice_id", selectedCycle.id).limit(800),
      ];
      if (selectedCycle.provider_bill_id) {
        candidateQueries.push(
          forCycle().eq("provider_bill_id", selectedCycle.provider_bill_id).limit(800),
        );
      }
      let forecastQuery = forCycle()
        .eq("bill_forecast_date", selectedCycle.reference_month);
      let postingQuery = forCycle()
        .gte("posting_date", period.from)
        .lte("posting_date", period.to);
      if (selectedCycle.provider_bill_id) {
        forecastQuery = forecastQuery.is("provider_bill_id", null);
        postingQuery = postingQuery.is("provider_bill_id", null);
      }
      let purchaseDateQuery = forCycle()
        .is("invoice_id", null)
        .gte("purchase_date", cutoffGraceFrom)
        .lte("purchase_date", period.to);
      let competenceDateQuery = forCycle()
        .is("invoice_id", null)
        .gte("competence_date", period.from)
        .lte("competence_date", period.to);
      if (selectedCycle.provider_bill_id) {
        purchaseDateQuery = purchaseDateQuery.is("provider_bill_id", null);
        competenceDateQuery = competenceDateQuery.is("provider_bill_id", null);
      }
      candidateQueries.push(
        forecastQuery.limit(800),
        postingQuery.limit(800),
        purchaseDateQuery.limit(800),
        competenceDateQuery.limit(800),
      );
      const candidates = await Promise.all(candidateQueries);
      const error = candidates.find(result => result.error)?.error ?? null;
      if (error) return { data: null, error };
      const rows = new Map<string, unknown>();
      for (const result of candidates) {
        for (const row of result.data ?? []) {
          rows.set(String((row as { id: string }).id), row);
        }
      }
      return { data: [...rows.values()], error: null };
    }
    return await baseQuery()
        .gte("competence_date", period.from)
        .lte("competence_date", period.to)
        .order("competence_date", { ascending: false })
        .limit(800);
  })();
  const invoiceEntriesQuery = isCardScope && selectedCycle && isPdfCycle
    ? supabase
      .from("invoice_entries")
      .select("id,bill_id,document_id,card_id,transaction_date,posting_date,description_raw,description_normalized,merchant_normalized,amount,amount_brl,original_amount,original_currency_code,exchange_rate,foreign_iof_amount,conversion_source,converted_at,entry_type,card_last_four,installment_number,installment_total,category_id,provider_transaction_id,confidence,review_status,is_ignored,created_at")
      .eq("owner_id", userId)
      .eq("bill_id", selectedCycle.id)
      .in("entry_type", [
        "purchase",
        "installment_purchase",
        "credit",
        "refund",
        "fee",
        "interest",
        "tax",
        "adjustment",
      ])
      .eq("is_ignored", false)
      .order("transaction_date", { ascending: false })
      .limit(1000)
    : emptyResult;
  const settled = await Promise.allSettled([
    supabase.from("financial_accounts").select("id,name,institution_name,account_type,current_balance,opening_balance,source,status,visibility,last_sync_at").eq("owner_id", userId).order("created_at"),
    transactionsQuery,
    purchasesQuery,
    Promise.resolve(cardsResult),
    supabase.from("financial_categories").select("id,name,type").eq("is_active", true).order("name"),
    supabase.from("bank_connections").select("id,connector_name,sync_status,last_successful_sync_at,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count,loans_sync_status,loans_sync_message,last_loans_sync_at").eq("owner_id", userId).eq("provider", "pluggy").neq("status", "disabled"),
    invoiceEntriesQuery,
  ]);
  const results = settled.map(result => result.status === "fulfilled"
    ? result.value as MovementSourceResult
    : { data: null, error: result.reason });
  const [
    accounts,
    transactions,
    cardPurchases,
    cards,
    categories,
    connections,
    invoiceEntries,
  ] = results;
  // Open invoices are a live Pluggy view. Historical installment occurrences
  // may support other reports, but they must never manufacture rows here.
  const occurrences: MovementSourceResult = { data: [], error: null };
  const resolved = resolveMovementSourceResults({
    accounts,
    transactions,
    cardPurchases,
    cards,
    categories,
    connections,
  });
  const cardRows = (resolved.cards ?? []) as CreditCard[];
  const cycleId = selectedCycle?.id ?? "";
  const cycleBillId = isPdfCycle ? cycleId : null;
  const rawMovements: CardCycleMovement[] = [];

  if (isCardScope && selectedCycle) {
    for (const purchase of resolved.cardPurchases) {
      if (
        (isOpenCycle && purchase.source !== "pluggy") ||
        purchase.transaction_role === "invoice_payment" ||
        ["forecast", "cancelled"].includes(purchase.status) ||
        (isOpenCycle && !cardPurchaseBelongsToCycle({
          invoiceId: purchase.invoice_id,
          providerBillId: purchase.provider_bill_id,
          billForecastDate: purchase.bill_forecast_date,
          postingDate: purchase.posting_date,
          competenceDate: purchase.competence_date,
          purchaseDate: purchase.purchase_date,
        }, {
          id: selectedCycle.id,
          providerBillId: selectedCycle.provider_bill_id,
          referenceMonth: selectedCycle.reference_month,
          cycleStartDate: selectedCycle.cycle_start_date,
          cycleEndDate: selectedCycle.cycle_end_date,
          trustProviderAssignment:
            isPdfCycle ||
            !["open", "partial"].includes(selectedCycle.status),
        }))
      ) {
        continue;
      }
      const signedAmount = Number(purchase.provider_signed_amount ??
        purchase.installment_amount) || 0;
      const foreign = normalizeCardMovementAmounts({
        persistedAmountBrl: purchase.amount_brl,
        pdfAmountBrl:
          purchase.conversion_source === "pdf" ? purchase.amount_brl : null,
        manualAmountBrl:
          purchase.conversion_source === "manual" ? purchase.amount_brl : null,
        providerAmountBrl:
          purchase.provider_metadata?.amountInAccountCurrency ??
          purchase.provider_metadata?.convertedAmount ??
          purchase.provider_metadata?.localAmount,
        amount: purchase.installment_amount,
        originalAmount: purchase.original_amount,
        originalCurrencyCode: purchase.original_currency_code,
        currencyCode: purchase.currency,
        exchangeRate: purchase.exchange_rate,
        iofAmountBrl: purchase.foreign_iof_amount,
        conversionSource: purchase.conversion_source,
        source: purchase.source,
        description: purchase.description,
      });
      const amountBrl = foreign.amountBrl;
      const effect = purchase.transaction_role === "refund" ||
        signedAmount < 0 ? "credit" : "debit";
      const entryType: CardCycleMovementEntryType =
        effect === "credit"
          ? "refund"
          : purchase.entry_type === "tax"
            ? "tax"
          : ["fee", "tax"].includes(
            String(purchase.provider_metadata?.movementType ?? ""),
          )
            ? purchase.provider_metadata?.movementType as
              CardCycleMovementEntryType
          : purchase.transaction_role === "adjustment"
            ? "adjustment"
            : (purchase.installment_count ?? 0) > 1
              ? "installment_purchase"
              : "purchase";
      const movementDate = isOpenCycle
        ? purchase.purchase_date
        : purchase.competence_date ?? purchase.purchase_date;
      rawMovements.push({
        id: `card-purchase:${purchase.id}`,
        cycleId,
        billId: cycleBillId,
        source: purchase.source === "manual" ? "manual" : "pluggy",
        sourceRecordId: purchase.id,
        reconciledSourceIds: [],
        cardId: purchase.card_id,
        instrumentId: purchase.instrument_id ?? null,
        cardLabel:
          purchase.credit_card_instruments?.display_name ||
          purchase.credit_cards?.name ||
          "Cartão",
        transactionDate: movementDate,
        competenceMonth: isOpenCycle
          ? selectedCycle.reference_month
          : movementDate.slice(0, 7) + "-01",
        description: purchase.description,
        merchantNormalized: purchase.merchant,
        amount: amountBrl ?? 0,
        amountBrl,
        originalAmount: foreign.originalAmount,
        originalCurrencyCode: foreign.originalCurrencyCode,
        exchangeRate: foreign.exchangeRate,
        foreignIofAmount: foreign.iofAmountBrl,
        conversionSource: foreign.conversionSource,
        convertedAt: purchase.converted_at ?? null,
        postingDate: purchase.posting_date ?? null,
        entryType,
        installmentNumber: purchase.installment_number,
        installmentTotal: purchase.installment_count,
        providerTransactionId: purchase.external_id ?? null,
        invoiceEntryId: null,
        reconciliationStatus:
          purchase.source === "manual" ? "manual" : "pluggy_only",
        effect,
        categoryId: purchase.category_id,
        reviewStatus: purchase.review_status,
        createdAt: purchase.created_at ?? null,
      });
    }

    if (isOpenCycle) {
      for (const transaction of resolved.transactions) {
        if (
          transaction.source !== "pluggy" ||
          !transaction.credit_card_id ||
          !cycleCardIds.includes(transaction.credit_card_id) ||
          transaction.transaction_role === "invoice_payment" ||
          transaction.cash_flow_kind === "invoice_payment" ||
          ["forecast", "cancelled"].includes(transaction.status)
        ) {
          continue;
        }
        const isCredit =
          ["refund", "reversal"].includes(transaction.transaction_type) ||
          transaction.transaction_role === "refund" ||
          transaction.bank_direction === "inflow";
        const entryType: CardCycleMovementEntryType = isCredit
          ? "refund"
          : transaction.transaction_role === "adjustment"
            ? "adjustment"
            : "purchase";
        const card = cardRows.find(item =>
          item.id === transaction.credit_card_id);
        const foreign = normalizeCardMovementAmounts({
          persistedAmountBrl: transaction.amount_brl,
          pdfAmountBrl:
            transaction.conversion_source === "pdf"
              ? transaction.amount_brl
              : null,
          manualAmountBrl:
            transaction.conversion_source === "manual"
              ? transaction.amount_brl
              : null,
          amount: transaction.amount,
          originalAmount: transaction.original_amount,
          originalCurrencyCode:
            transaction.original_currency_code ??
            transaction.original_currency,
          exchangeRate: transaction.exchange_rate,
          iofAmountBrl: transaction.foreign_iof_amount,
          conversionSource: transaction.conversion_source,
          source: transaction.source,
          description: transaction.description,
        });
        rawMovements.push({
          id: `financial-transaction:${transaction.id}`,
          cycleId,
          billId: null,
          source: transaction.source === "pluggy" ? "pluggy" : "manual",
          sourceRecordId: transaction.id,
          reconciledSourceIds: [],
          cardId: transaction.credit_card_id,
          instrumentId: null,
          cardLabel: transaction.credit_cards?.name || card?.name || "Cartão",
          transactionDate: transaction.competence_date,
          competenceMonth: selectedCycle.reference_month,
          description: transaction.description,
          merchantNormalized: null,
          amount: foreign.amountBrl ?? 0,
          amountBrl: foreign.amountBrl,
          originalAmount: foreign.originalAmount,
          originalCurrencyCode: foreign.originalCurrencyCode,
          exchangeRate: foreign.exchangeRate,
          foreignIofAmount: foreign.iofAmountBrl,
          conversionSource: foreign.conversionSource,
          convertedAt: transaction.converted_at ?? null,
          postingDate: transaction.provider_posted_at?.slice(0, 10) ?? null,
          entryType,
          installmentNumber: null,
          installmentTotal: null,
          providerTransactionId: transaction.external_id ?? null,
          invoiceEntryId: null,
          reconciliationStatus:
            transaction.source === "pluggy" ? "pluggy_only" : "manual",
          effect: isCredit ? "credit" : "debit",
          categoryId: transaction.category_id,
          reviewStatus: transaction.review_status,
          createdAt: transaction.created_at ?? null,
        });
      }
    }
  }

  if (!invoiceEntries.error && selectedCycle) {
    const rows = (invoiceEntries.data ?? []) as Array<{
      id: string;
      bill_id: string;
      card_id: string;
      transaction_date: string | null;
      posting_date: string | null;
      description_raw: string;
      merchant_normalized: string | null;
      amount: number | string;
      amount_brl: number | string | null;
      original_amount: number | string | null;
      original_currency_code: string | null;
      exchange_rate: number | string | null;
      foreign_iof_amount: number | string | null;
      conversion_source: string | null;
      converted_at: string | null;
      entry_type: string;
      card_last_four: string | null;
      installment_number: number | null;
      installment_total: number | null;
      category_id: string | null;
      provider_transaction_id: string | null;
      review_status: string;
      created_at: string | null;
    }>;
    for (const entry of rows) {
      const foreign = normalizeCardMovementAmounts({
        pdfAmountBrl: entry.amount_brl ?? entry.amount,
        amount: entry.amount,
        originalAmount: entry.original_amount,
        originalCurrencyCode: entry.original_currency_code,
        exchangeRate: entry.exchange_rate,
        iofAmountBrl: entry.foreign_iof_amount,
        conversionSource: entry.conversion_source,
        source: "pdf",
        description: entry.description_raw,
      });
      const rawAmount = foreign.amountBrl ?? 0;
      const effect = resolveInvoiceEntryEffect(entry.entry_type, rawAmount);
      if (effect === "exclude") continue;
      const card = cardRows.find(item => item.id === entry.card_id);
      const instrument = card?.credit_card_instruments?.find(item =>
        item.last_four_digits === entry.card_last_four);
      rawMovements.push({
        id: `invoice-entry:${entry.id}`,
        cycleId,
        billId: entry.bill_id,
        source: "pdf",
        sourceRecordId: entry.id,
        reconciledSourceIds: entry.provider_transaction_id
          ? [entry.provider_transaction_id]
          : [],
        cardId: entry.card_id,
        instrumentId: instrument?.id ?? null,
        cardLabel: instrument?.display_name || card?.name || "Cartão",
        transactionDate: entry.transaction_date,
        competenceMonth: selectedCycle.reference_month,
        description: entry.description_raw,
        merchantNormalized: entry.merchant_normalized,
        amount: Math.abs(rawAmount),
        amountBrl: foreign.amountBrl,
        originalAmount: foreign.originalAmount,
        originalCurrencyCode: foreign.originalCurrencyCode,
        exchangeRate: foreign.exchangeRate,
        foreignIofAmount: foreign.iofAmountBrl,
        conversionSource: foreign.conversionSource,
        convertedAt: entry.converted_at,
        postingDate: entry.posting_date,
        entryType: entry.entry_type as CardCycleMovementEntryType,
        installmentNumber: entry.installment_number,
        installmentTotal: entry.installment_total,
        providerTransactionId: entry.provider_transaction_id,
        invoiceEntryId: entry.id,
        reconciliationStatus: entry.provider_transaction_id
          ? "matched"
          : "pdf_only",
        effect,
        categoryId: entry.category_id,
        reviewStatus: entry.review_status,
        createdAt: entry.created_at,
      });
    }
  }

  if (!occurrences.error && selectedCycle) {
    const rows = (occurrences.data ?? []) as unknown as Array<{
      id: string;
      card_id: string;
      invoice_entry_id: string | null;
      competence_month: string;
      installment_number: number;
      total_installments: number;
      amount: number | string;
      due_date: string | null;
      card_installment_plans: {
        card_last_four: string | null;
        merchant_normalized: string;
        description_reference: string;
      } | null;
    }>;
    for (const occurrence of rows) {
      const card = cardRows.find(item => item.id === occurrence.card_id);
      const instrument = card?.credit_card_instruments?.find(item =>
        item.last_four_digits === occurrence.card_installment_plans?.card_last_four);
      rawMovements.push({
        id: `installment-occurrence:${occurrence.id}`,
        cycleId,
        billId: null,
        source: "projection",
        sourceRecordId: occurrence.id,
        reconciledSourceIds: [],
        cardId: occurrence.card_id,
        instrumentId: instrument?.id ?? null,
        cardLabel: instrument?.display_name || card?.name || "Cartão",
        transactionDate: occurrence.due_date ?? selectedCycle.cycle_end_date,
        competenceMonth: occurrence.competence_month,
        description:
          occurrence.card_installment_plans?.description_reference ||
          "Parcela comprometida",
        merchantNormalized:
          occurrence.card_installment_plans?.merchant_normalized ?? null,
        amount: Math.abs(Number(occurrence.amount) || 0),
        amountBrl: Math.abs(Number(occurrence.amount) || 0),
        originalAmount: null,
        originalCurrencyCode: null,
        exchangeRate: null,
        foreignIofAmount: null,
        conversionSource: null,
        convertedAt: null,
        postingDate: null,
        entryType: "installment_purchase",
        installmentNumber: occurrence.installment_number,
        installmentTotal: occurrence.total_installments,
        providerTransactionId: null,
        invoiceEntryId: occurrence.invoice_entry_id,
        reconciliationStatus: "projected_only",
        effect: "debit",
      });
    }
  }

  const deduplicated = isOpenCycle
    ? getOpenCardCycleMovements(rawMovements.filter(movement =>
      movement.source === "pluggy"))
    : getClosedCardCycleMovements(rawMovements);
  const normalizedCardPurchases = deduplicated.map(movement => {
    const isCredit = movement.effect === "credit";
    return {
      id: movement.id,
      card_id: movement.cardId ?? selectedCycle?.card_id ?? "",
      instrument_id: movement.instrumentId,
      external_id: movement.providerTransactionId ?? movement.sourceRecordId,
      invoice_id: movement.billId,
      provider_bill_id: null,
      description: movement.description,
      total_amount: movement.amount,
      installment_amount: isCredit ? -movement.amount : movement.amount,
      amount_brl: movement.amountBrl,
      original_amount: movement.originalAmount,
      original_currency_code: movement.originalCurrencyCode,
      exchange_rate: movement.exchangeRate,
      foreign_iof_amount: movement.foreignIofAmount,
      conversion_source: movement.conversionSource,
      converted_at: movement.convertedAt,
      purchase_date: movement.transactionDate ?? period.to,
      posting_date: movement.postingDate,
      competence_date: movement.transactionDate ?? period.to,
      created_at: movement.createdAt ?? null,
      source: movement.source,
      source_type: "card",
      financial_origin: "invoice",
      transaction_role: isCredit
        ? "refund"
        : movement.entryType === "adjustment"
          ? "adjustment"
          : "consumption",
      status: movement.source === "projection" ? "projected" : "realized",
      review_status: movement.reviewStatus === "pending" ? "pending" : "reviewed",
      instrument_review_status: movement.instrumentId ? "identified" : "pending",
      provider_category: null,
      merchant: movement.merchantNormalized,
      installment_number: movement.installmentNumber,
      installment_count: movement.installmentTotal,
      category_id: movement.categoryId ?? null,
      invoice_reference: null,
      bill_forecast_date: null,
      visibility: "private",
      cycle_id: movement.cycleId,
      entry_type: movement.entryType,
      reconciliation_status: movement.reconciliationStatus,
      reconciled_source_ids: movement.reconciledSourceIds,
      competence_month: movement.competenceMonth,
      credit_cards: {
        name: movement.cardLabel,
        institution_name: null,
        last_four_digits: null,
      },
      credit_card_instruments: movement.instrumentId
        ? {
          display_name: movement.cardLabel,
          last_four_digits: null,
          card_kind: "unknown",
        }
        : null,
      financial_categories: null,
    } as CardPurchase;
  });

  const optionalCycleSources = [
    {
      result: invoiceEntries,
      source: "invoice_entries" as const,
      message: "Lançamentos do PDF temporariamente indisponíveis.",
    },
    {
      result: occurrences,
      source: "card_installment_occurrences" as const,
      message: "Parcelas comprometidas temporariamente indisponíveis.",
    },
  ];
  for (const optional of optionalCycleSources) {
    if (!optional.result.error) continue;
    const context = `getMovementsData.${optional.source}`;
    logSupabaseError(optional.result.error, context);
    const normalized = normalizeSupabaseError(optional.result.error, context);
    resolved.warnings.push({
      source: optional.source,
      message: optional.message,
      ...(normalized.code ? { code: normalized.code } : {}),
    });
    resolved.unavailableSources.push(optional.source);
    resolved.completeness = "partial";
  }
  return {
    ...resolved,
    transactions: isCardScope ? [] : resolved.transactions,
    cardPurchases: isCardScope
      ? normalizedCardPurchases
      : resolved.cardPurchases,
    installmentsDataStatus: !isCardScope
      ? "available" as const
      : occurrences.error
        ? "unavailable" as const
        : normalizedCardPurchases.some(purchase =>
          purchase.entry_type === "installment_purchase")
          ? "available" as const
          : "confirmed_zero" as const,
  };
}

type OpenInvoiceCycleRecord = {
  id: string;
  workspace_id: string | null;
  card_id: string;
  reference_month: string;
  cycle_start_date: string;
  cycle_end_date: string;
  closing_date: string | null;
  due_date: string | null;
  status: string;
  source: string | null;
  total_source: string | null;
  provider_bill_id: string | null;
  confirmed_open_total: number | string | null;
  confirmed_open_total_at: string | null;
  confirmed_open_total_source: string | null;
  provider_invoice_total: number | string | null;
  manual_invoice_total: number | string | null;
  confirmed_invoice_total: number | string | null;
  calculated_invoice_total: number | string | null;
  last_reliable_invoice_total: number | string | null;
  current_display_total: number | string | null;
  data_completeness: string | null;
  provider_status: string | null;
  last_complete_sync_at: string | null;
  provider_updated_at: string | null;
  updated_at: string | null;
  paid_amount: number | string | null;
  last_sync_at: string | null;
  preservation_reason: string | null;
};

function resolvedOpenInvoiceStatus(value: string) {
  if (value === "paid") return "paid" as const;
  if (value === "overdue") return "overdue" as const;
  if (value === "open" || value === "partial") return "open" as const;
  return "closed" as const;
}

export async function resolveOpenCardInvoice(
  supabase: Client,
  userId: string,
  input: {
    workspaceId?: string | null;
    cycleId?: string;
    cardAccountId?: string;
    referenceDate?: string | Date;
    movementData?: Awaited<ReturnType<typeof getMovementsData>>;
  },
): Promise<ResolvedOpenCardInvoice | null> {
  const workspaceId = input.workspaceId ?? null;
  const referenceDate = (
    input.referenceDate instanceof Date
      ? input.referenceDate.toISOString()
      : input.referenceDate ?? new Date().toISOString()
  ).slice(0, 10);
  let cycleQuery = supabase
    .from("card_invoices")
    .select(
      "id,workspace_id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,status,source,total_source,provider_bill_id,confirmed_open_total,confirmed_open_total_at,confirmed_open_total_source,provider_invoice_total,manual_invoice_total,confirmed_invoice_total,calculated_invoice_total,last_reliable_invoice_total,current_display_total,data_completeness,provider_status,last_complete_sync_at,last_sync_at,preservation_reason,paid_amount,provider_updated_at,updated_at",
    )
    .neq("status", "cancelled");
  cycleQuery = workspaceId
    ? cycleQuery.eq("workspace_id", workspaceId).eq("visibility", "workspace")
    : cycleQuery.eq("owner_id", userId).is("workspace_id", null);
  if (input.cycleId) {
    cycleQuery = cycleQuery.eq("id", input.cycleId);
  } else {
    cycleQuery = cycleQuery
      .eq("status", "open")
      .lte("cycle_start_date", referenceDate)
      .gte("cycle_end_date", referenceDate);
  }
  if (input.cardAccountId) {
    cycleQuery = cycleQuery.eq("card_id", input.cardAccountId);
  }
  const cycleResult = await cycleQuery
    .order("cycle_end_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cycleResult.error) {
    throwSupabaseError(
      cycleResult.error,
      "resolveOpenCardInvoice.card_invoices",
      "Não foi possível resolver a fatura aberta.",
    );
  }
  if (!cycleResult.data) return null;
  const cycle = cycleResult.data as unknown as OpenInvoiceCycleRecord;

  let cardsQuery = supabase.from("credit_cards").select(
    "id,bank_connection_id,name,institution_name,last_four_digits,brand,source,status,user_archived_at,workspace_id,visibility,credit_card_instruments(id,last_four_digits,display_name,card_kind,user_archived_at)",
  );
  cardsQuery = workspaceId
    ? cardsQuery.eq("workspace_id", workspaceId).eq("visibility", "workspace")
    : cardsQuery.eq("owner_id", userId).is("workspace_id", null);
  const cardsResult = await cardsQuery;
  if (cardsResult.error) {
    throwSupabaseError(
      cardsResult.error,
      "resolveOpenCardInvoice.credit_cards",
      "Não foi possível identificar os cartões da fatura aberta.",
    );
  }
  const cards = (cardsResult.data ?? []) as unknown as CreditCard[];
  const account = cards.find(card => card.id === cycle.card_id);
  if (!account) return null;
  const cardIds = resolveOpenProjectionCardAccountIds(
    cycle.card_id,
    cards,
  ).cardIds;

  const confirmationsResult = await supabase
    .from("card_invoice_confirmations")
    .select("id,card_id,official_amount,source,informed_at,updated_at")
    .eq("owner_id", userId)
    .eq("card_id", cycle.card_id)
    .eq("reference_month", cycle.reference_month)
    .order("informed_at", { ascending: false });
  if (confirmationsResult.error) {
    throwSupabaseError(
      confirmationsResult.error,
      "resolveOpenCardInvoice.card_invoice_confirmations",
      "Não foi possível carregar a confirmação da fatura aberta.",
    );
  }
  const confirmations = confirmationsResult.data ?? [];
  const confirmation = confirmations[0] as {
    official_amount?: unknown;
    informed_at?: string | null;
    updated_at?: string | null;
  } | undefined;

  let detailedTotal = openInvoiceMoney(cycle.calculated_invoice_total);
  let newPurchasesTotal: number | null = null;
  let postedInstallmentsTotal: number | null = null;
  let projectedInstallmentsTotal: number | null = null;
  let feesAndTaxesTotal: number | null = null;
  let creditsAndRefundsTotal: number | null = null;
  let detailsCompleteness: ResolvedOpenCardInvoice["detailsCompleteness"] =
    detailedTotal === null ? "unavailable" : "partial";
  try {
    const movements = input.movementData ?? await getMovementsData(
      supabase,
      userId,
      {
        from: cycle.cycle_start_date,
        to: cycle.cycle_end_date,
        type: "card",
        cycleId: cycle.id,
      },
    );
    const breakdown = calculateOpenCardCycleBreakdown({
      movements: movements.cardPurchases.map(purchase => ({
        id: purchase.id,
        amount: Math.abs(Number(
          purchase.amount_brl,
        ) || 0),
        effect:
          purchase.transaction_role === "refund" ||
          Number(purchase.installment_amount) < 0
            ? "credit" as const
            : "debit" as const,
        entryType: purchase.entry_type,
        source: purchase.source,
        reconciliationStatus: purchase.reconciliation_status,
        installmentNumber: purchase.installment_number,
        installmentTotal: purchase.installment_count,
        description: purchase.description,
        cardId: purchase.card_id,
        competenceMonth: purchase.competence_month,
      })),
      confirmedOpenTotal: null,
      installmentsDataStatus: movements.installmentsDataStatus,
    });
    detailedTotal = breakdown.detailedTotal;
    newPurchasesTotal = breakdown.newPurchasesTotal;
    postedInstallmentsTotal = breakdown.postedInstallmentsTotal;
    projectedInstallmentsTotal =
      movements.installmentsDataStatus === "unavailable"
        ? null
        : breakdown.projectedUnpostedInstallmentsTotal;
    feesAndTaxesTotal = breakdown.feesAndTaxesTotal;
    creditsAndRefundsTotal = breakdown.creditsAndRefundsTotal;
    detailsCompleteness =
      movements.completeness === "complete" &&
      movements.installmentsDataStatus !== "unavailable" &&
      cycle.data_completeness !== "partial" &&
      !movements.cardPurchases.some(purchase =>
        purchase.amount_brl === null &&
        purchase.original_currency_code &&
        purchase.original_currency_code !== "BRL")
        ? "complete"
        : "partial";
  } catch {
    // A confirmed total is independent from a temporarily unavailable detail.
  }

  // A projeção da fatura aberta é um retrato das compras que a Pluggy
  // sincronizou para este ciclo. Totais manuais, PDFs e snapshots antigos
  // continuam preservados no histórico, mas não alteram esta projeção viva.
  const total = resolveOpenInvoiceTotal({
    calculatedTotal: detailedTotal,
    calculatedReliable: detailedTotal !== null,
    calculatedUpdatedAt: cycle.last_sync_at ?? cycle.updated_at,
  });
  const explicitConfirmedOpenTotal =
    openInvoiceMoney(cycle.confirmed_open_total) ??
    openInvoiceMoney(confirmation?.official_amount);
  const confirmedOpenTotal = explicitConfirmedOpenTotal;
  const dataCompleteness: ResolvedOpenCardInvoice["dataCompleteness"] =
    detailsCompleteness === "complete"
      ? "complete"
      : total.amount !== null
        ? "partial"
        : "unavailable";
  return {
    cycleId: cycle.id,
    cardAccountId: cycle.card_id,
    cardIds,
    cardName: account.name,
    cardLastFour: account.last_four_digits,
    cycleStartDate: cycle.cycle_start_date,
    cycleEndDate: cycle.cycle_end_date,
    closingDate: cycle.closing_date,
    dueDate: cycle.due_date,
    status: resolvedOpenInvoiceStatus(cycle.status),
    confirmedOpenTotal,
    detailedTotal,
    newPurchasesTotal,
    postedInstallmentsTotal,
    projectedInstallmentsTotal,
    feesAndTaxesTotal,
    creditsAndRefundsTotal,
    reconciliationDifference: openInvoiceDifference(total.amount, detailedTotal),
    displayTotal: total.amount,
    displayTotalSource: total.source,
    dataCompleteness,
    totalReliability:
      total.source === "confirmed_open_total"
        ? "confirmed"
        : ["provider_bill", "manual", "last_reliable"].includes(total.source)
          ? "reliable"
          : total.source === "calculated"
            ? "estimated"
            : "unavailable",
    detailsCompleteness,
    updatedAt: total.updatedAt,
    confirmedAt:
      cycle.confirmed_open_total_at ??
      confirmation?.informed_at ??
      confirmation?.updated_at ??
      null,
    sourceLabel: resolvedOpenInvoiceSourceLabel({
      source: total.source,
      institutionName: account.institution_name,
      providerOrigin: account.source === "pluggy",
    }),
    snapshotCount: confirmations.length,
    cacheTag: openInvoiceCacheTag(workspaceId, cycle.id),
  };
}

export async function getResolvedCardCycleDetails(
  supabase: Client,
  userId: string,
  input: {
    workspaceId?: string | null;
    cycleId: string;
    cardId?: string;
  },
): Promise<ResolvedCardCycleDetails | null> {
  const cycles = await getAvailableCardCycles(
    supabase,
    userId,
    input.workspaceId ?? null,
  );
  const cycle = cycles.find(item =>
    item.cycleId === input.cycleId &&
    (!input.cardId ||
      item.cardAccountId === input.cardId ||
      item.cardIds.includes(input.cardId)));
  if (!cycle) return null;

  const movementData = await getMovementsData(supabase, userId, {
    from: cycle.cycleStartDate,
    to: cycle.cycleEndDate,
    type: "card",
    cycleId: cycle.cycleId,
  });
  const invoice = await resolveOpenCardInvoice(supabase, userId, {
    workspaceId: input.workspaceId,
    cycleId: cycle.cycleId,
    movementData,
  });
  if (!invoice) return null;

  let metadataQuery = supabase
    .from("card_invoices")
    .select(
      "id,confirmed_open_total_source,paid_amount,last_complete_sync_at,last_sync_at,preservation_reason,provider_status,provider_updated_at,updated_at,credit_cards:credit_cards!card_invoices_card_id_fkey(source,brand)",
    )
    .eq("id", cycle.cycleId);
  metadataQuery = input.workspaceId
    ? metadataQuery
      .eq("workspace_id", input.workspaceId)
      .eq("visibility", "workspace")
    : metadataQuery.eq("owner_id", userId).is("workspace_id", null);
  const metadataResult = await metadataQuery.maybeSingle();
  if (metadataResult.error) {
    throwSupabaseError(
      metadataResult.error,
      "getResolvedCardCycleDetails.card_invoices",
      "Não foi possível carregar os metadados do ciclo da fatura.",
    );
  }
  const metadata = metadataResult.data as {
    confirmed_open_total_source?: string | null;
    paid_amount?: number | string | null;
    last_complete_sync_at?: string | null;
    last_sync_at?: string | null;
    preservation_reason?: string | null;
    provider_status?: string | null;
    provider_updated_at?: string | null;
    updated_at?: string | null;
    credit_cards?: { source?: string | null; brand?: string | null } | null;
  } | null;

  const historyResult = await supabase
    .from("credit_card_statement_value_history")
    .select("id,new_display_total_amount,change_amount,change_direction,change_reason,change_source,created_at")
    .eq("statement_id", cycle.cycleId)
    .order("created_at", { ascending: false })
    .limit(12);
  if (historyResult.error) {
    throwSupabaseError(
      historyResult.error,
      "getResolvedCardCycleDetails.statement_value_history",
      "NÃ£o foi possÃ­vel carregar o histÃ³rico do valor da fatura.",
    );
  }

  return buildResolvedCardCycleDetails({
    cycle,
    invoice,
    purchases: movementData.cardPurchases,
    installmentsDataStatus: movementData.installmentsDataStatus,
    movementCompleteness: movementData.completeness,
    unavailableSources: movementData.unavailableSources,
    warnings: movementData.warnings.map(warning => warning.message),
    cardSource: metadata?.credit_cards?.source,
    cardBrand: metadata?.credit_cards?.brand,
    confirmedOpenTotalSource: metadata?.confirmed_open_total_source,
    paidAmount: metadata?.paid_amount,
    lastCompleteSyncAt: metadata?.last_complete_sync_at,
    lastAttemptAt:
      metadata?.last_sync_at ??
      metadata?.provider_updated_at ??
      metadata?.updated_at,
    preservationReason: metadata?.preservation_reason,
    providerStatus: metadata?.provider_status,
    valueHistory: (historyResult.data ?? []).map(row => ({
      id: String(row.id),
      displayTotal: Number(row.new_display_total_amount ?? 0),
      changeAmount: Number(row.change_amount ?? 0),
      direction: String(row.change_direction) as "increase" | "decrease" | "unchanged",
      reason: String(row.change_reason),
      source: String(row.change_source),
      createdAt: String(row.created_at),
    })),
  });
}

export async function getFinanceData(supabase:Client,userId:string){const [accounts,transactions,cardPurchases,cards,categories,investments,loans,connections]=await Promise.all([
 supabase.from("financial_accounts").select("id,name,institution_name,account_type,current_balance,opening_balance,source,status,visibility,last_sync_at").eq("owner_id",userId).order("created_at"),
 supabase.from("financial_transactions").select("id,external_id,description,amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,provider_type,operation_type,operation_type_additional_info,classification_source,classification_confidence,classification_rule,classification_version,manually_confirmed,manual_override_at,manual_override_by,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,date_source,date_confidence,date_override_reason,created_at,source,visibility,account_id,credit_card_id,invoice_id,payment_source,transfer_group_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").eq("owner_id",userId).or("migrated_card_purchase_id.is.null,transaction_role.eq.invoice_payment,cash_flow_kind.eq.invoice_payment").order("competence_date",{ascending:false}).limit(500),
 supabase.from("card_purchases").select(CARD_PURCHASE_SELECT).eq("owner_id",userId).order("purchase_date",{ascending:false}).limit(2000),
 supabase.from("credit_cards").select("id,external_id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source,credit_card_instruments(id,credit_card_id,external_id,last_four_digits,card_kind,display_name,provider_status,user_archived_at,source,payment_responsible_person_id,payment_responsible_person:financial_people!credit_card_instruments_payment_responsible_person_id_fkey(id,name)),card_invoice_confirmations(id,card_id,reference_month,official_amount,source,informed_at,note)").eq("owner_id",userId).order("created_at"),
 supabase.from("financial_categories").select("id,name,type").eq("is_active",true).order("name"),
 supabase.from("financial_investments").select("id,name,investment_type,institution_name,balance,currency,last_sync_at").eq("owner_id",userId).order("balance",{ascending:false}),
 supabase.from("financial_loans").select("id,name,institution_name,loan_type,subtype,contracted_amount,outstanding_balance,installment_amount,installment_count,installments_paid,installments_remaining,interest_rate,effective_cost_rate,contract_date,first_installment_date,next_installment_date,final_due_date,payroll_deducted,payment_source,currency,status,source,last_sync_at,provider_updated_at,notes").eq("owner_id",userId).neq("status","unavailable").order("created_at",{ascending:false}),
 supabase.from("bank_connections").select("id,connector_name,sync_status,last_successful_sync_at,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count,loans_sync_status,loans_sync_message,last_loans_sync_at").eq("owner_id",userId).eq("provider","pluggy").neq("status","disabled").order("last_successful_sync_at",{ascending:false})]);const checks=[[accounts,"contas"],[transactions,"movimentacoes"],[cardPurchases,"compras de cartao"],[cards,"cartoes"],[categories,"categorias"],[investments,"investimentos"],[loans,"emprestimos"],[connections,"conexoes"]] as const;for(const [result,context] of checks)if(result.error)throwSupabaseError(result.error,`carregar ${context}`,`Nao foi possivel carregar ${context}.`);const connectionRows=(connections.data??[]) as BankConnectionSummary[];const connectionMap=new Map(connectionRows.map(connection=>[String(connection.id),connection]));const cardRows=((cards.data??[]) as unknown as CreditCard[]).map(card=>{const connection=card.bank_connection_id?connectionMap.get(card.bank_connection_id):undefined;return {...card,bank_connections:connection?{last_complete_sync_at:connection.last_complete_sync_at??null,data_completeness:connection.data_completeness??"unknown",provider_status:connection.provider_status??"waiting"}:null}});return {accounts:(accounts.data??[]) as FinancialAccount[],transactions:(transactions.data??[]) as unknown as FinancialTransaction[],cardPurchases:(cardPurchases.data??[]) as unknown as CardPurchase[],cards:cardRows,categories:categories.data??[],investments:(investments.data??[]) as FinancialInvestment[],loans:(loans.data??[]) as FinancialLoan[],connections:connectionRows}}
