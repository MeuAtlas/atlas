import type { BankConnectionSummary,CardPurchase,CreditCard,FinancialAccount,FinancialInvestment,FinancialLoan,FinancialTransaction,StoredCardInvoice } from "./types";
import { throwSupabaseError } from "@/lib/errors";
import { requireQuery,withQueryFallback } from "@/lib/supabase/query-fallback";
import { shiftFinanceMonth, type FinanceMonthPeriod } from "./monthly-result";
import {
  decodeInvoiceHistoryCursor,
  encodeInvoiceHistoryCursor,
  HISTORICAL_INVOICE_STATUSES,
  normalizeHistoricalInvoice,
  sortHistoricalInvoices,
  type CreditCardInvoiceHistoryResult,
  type HistoricalInvoiceStatus,
} from "./invoice-history";
type Client=Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export const CARD_PURCHASE_SELECT =
  "id,workspace_id,card_id,external_id,instrument_id,instrument_review_status,invoice_id,provider_bill_id,description,total_amount,total_purchase_amount,is_installment,installment_amount,purchase_date,competence_date,created_at,installment_number,installment_count,installment_source,installment_confidence,installment_plan_id,installment_manually_confirmed,source,source_type,financial_origin,transaction_role,status,review_status,invoice_reference,bill_forecast_date,provider_category,merchant,visibility,category_id,original_amount,credit_cards:credit_cards!card_purchases_card_id_fkey(name,institution_name,last_four_digits),credit_card_instruments(last_four_digits,card_kind,display_name),financial_categories:financial_categories!card_purchases_category_id_fkey(name)";

export async function getCardInvoiceHistory(
  supabase: Client,
  userId: string,
  cardId: string,
) {
  const result = await supabase
    .from("card_invoices")
    .select(
      "id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,total_amount,paid_amount,paid_at,outstanding_amount,purchase_count,status,external_id,provider_invoice_total,calculated_invoice_total,manual_invoice_total,confirmed_invoice_total,minimum_payment_amount,provider_bill_status,total_source,reconciliation_difference,reconciliation_status,provider_updated_at,invoice_breakdown",
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
      "id,card_id,reference_month,cycle_start_date,cycle_end_date,closing_date,due_date,total_amount,paid_amount,paid_at,outstanding_amount,purchase_count,status,external_id,provider_invoice_total,calculated_invoice_total,manual_invoice_total,confirmed_invoice_total,minimum_payment_amount,provider_bill_status,total_source,reconciliation_difference,reconciliation_status,provider_updated_at,invoice_breakdown",
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
 let transactionsQuery=supabase.from("financial_transactions").select("id,external_id,description,amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,provider_type,operation_type,operation_type_additional_info,classification_source,classification_confidence,classification_rule,classification_version,manually_confirmed,manual_override_at,manual_override_by,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,date_source,date_confidence,date_override_reason,created_at,source,visibility,account_id,credit_card_id,invoice_id,loan_id,recurring_rule_id,payment_source,transfer_group_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").is("migrated_card_purchase_id",null).gte("competence_date",historyStart).order("competence_date",{ascending:false}).limit(1200);
 let purchasesQuery=supabase.from("card_purchases").select(CARD_PURCHASE_SELECT).or(`competence_date.gte.${historyStart},and(competence_date.is.null,purchase_date.gte.${historyStart})`).order("purchase_date",{ascending:false}).limit(2000);
 let cardsQuery=supabase.from("credit_cards").select("id,workspace_id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source,credit_card_instruments(id,credit_card_id,external_id,last_four_digits,card_kind,display_name,provider_status,user_archived_at,source),card_invoice_confirmations(id,card_id,reference_month,official_amount,source,informed_at,note)").order("created_at");
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
  .is("migrated_card_purchase_id",null)
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

export async function getFinanceData(supabase:Client,userId:string){const [accounts,transactions,cardPurchases,cards,categories,investments,loans,connections]=await Promise.all([
 supabase.from("financial_accounts").select("id,name,institution_name,account_type,current_balance,opening_balance,source,status,visibility,last_sync_at").eq("owner_id",userId).order("created_at"),
 supabase.from("financial_transactions").select("id,description,amount,transaction_type,transaction_role,source_type,financial_origin,cash_flow_kind,bank_direction,financial_nature,financial_role,provider_type,operation_type,operation_type_additional_info,classification_source,classification_confidence,classification_rule,classification_version,manually_confirmed,manual_override_at,manual_override_by,status,competence_date,due_date,realized_at,provider_posted_at,bank_posted_at,effective_at,user_effective_at,date_source,date_confidence,date_override_reason,source,visibility,account_id,credit_card_id,invoice_id,destination_account_id,category_id,workspace_id,review_status,suspected_transfer,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name),credit_cards:credit_cards!financial_transactions_credit_card_id_fkey(name,last_four_digits),financial_categories:financial_categories!financial_transactions_category_id_fkey(name)").eq("owner_id",userId).is("migrated_card_purchase_id",null).order("competence_date",{ascending:false}).limit(500),
 supabase.from("card_purchases").select(CARD_PURCHASE_SELECT).eq("owner_id",userId).order("purchase_date",{ascending:false}).limit(2000),
 supabase.from("credit_cards").select("id,bank_connection_id,name,institution_name,last_four_digits,brand,credit_limit,used_limit,current_balance,provider_status,provider_invoice_total,account_credit_balance,provider_bill_id,provider_bill_closing_date,provider_bill_due_date,provider_cycle_start_date,dates_source,closing_day,due_day,status,user_archived_at,visibility,linked_account_id,last_sync_at,source,credit_card_instruments(id,credit_card_id,external_id,last_four_digits,card_kind,display_name,provider_status,user_archived_at,source),card_invoice_confirmations(id,card_id,reference_month,official_amount,source,informed_at,note)").eq("owner_id",userId).order("created_at"),
 supabase.from("financial_categories").select("id,name,type").eq("is_active",true).order("name"),
 supabase.from("financial_investments").select("id,name,investment_type,institution_name,balance,currency,last_sync_at").eq("owner_id",userId).order("balance",{ascending:false}),
 supabase.from("financial_loans").select("id,name,institution_name,loan_type,subtype,contracted_amount,outstanding_balance,installment_amount,installment_count,installments_paid,installments_remaining,interest_rate,effective_cost_rate,contract_date,first_installment_date,next_installment_date,final_due_date,payroll_deducted,payment_source,currency,status,source,last_sync_at,provider_updated_at,notes").eq("owner_id",userId).neq("status","unavailable").order("created_at",{ascending:false}),
 supabase.from("bank_connections").select("id,connector_name,sync_status,last_successful_sync_at,last_complete_sync_at,last_sync_at,provider_status,data_completeness,incident_message,stale_since,partial_data_count,loans_sync_status,loans_sync_message,last_loans_sync_at").eq("owner_id",userId).eq("provider","pluggy").neq("status","disabled").order("last_successful_sync_at",{ascending:false})]);const checks=[[accounts,"contas"],[transactions,"movimentacoes"],[cardPurchases,"compras de cartao"],[cards,"cartoes"],[categories,"categorias"],[investments,"investimentos"],[loans,"emprestimos"],[connections,"conexoes"]] as const;for(const [result,context] of checks)if(result.error)throwSupabaseError(result.error,`carregar ${context}`,`Nao foi possivel carregar ${context}.`);const connectionRows=(connections.data??[]) as BankConnectionSummary[];const connectionMap=new Map(connectionRows.map(connection=>[String(connection.id),connection]));const cardRows=((cards.data??[]) as unknown as CreditCard[]).map(card=>{const connection=card.bank_connection_id?connectionMap.get(card.bank_connection_id):undefined;return {...card,bank_connections:connection?{last_complete_sync_at:connection.last_complete_sync_at??null,data_completeness:connection.data_completeness??"unknown",provider_status:connection.provider_status??"waiting"}:null}});return {accounts:(accounts.data??[]) as FinancialAccount[],transactions:(transactions.data??[]) as unknown as FinancialTransaction[],cardPurchases:(cardPurchases.data??[]) as unknown as CardPurchase[],cards:cardRows,categories:categories.data??[],investments:(investments.data??[]) as FinancialInvestment[],loans:(loans.data??[]) as FinancialLoan[],connections:connectionRows}}
