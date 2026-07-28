import {
  bankMovementDate,
  resolveBankTransactionDirection,
} from "./account-movement";
import {
  calculateBankAccountCashFlow as summarizeBankAccountCashFlow,
  type BankAccountCashFlowSummary,
} from "./bank-cash-flow";
import {
  defaultCardCycle,
  resolveLegacyCardCycle,
  type AvailableCardCycle,
} from "./card-cycles";
import { formatCurrency } from "./format";
import {
  formatMoneyByCurrency,
  normalizeForeignCardMovement,
  type ForeignConversionSource,
} from "./foreign-card-movement";
import { z } from "zod";
import type {
  CardPurchase,
  FinancialAccount,
  FinancialTransaction,
} from "./types";

export type MovementDirection = "inflow" | "outflow" | "transfer" | "card" | "adjustment";
export const movementSourceFilterSchema = z.enum([
  "all",
  "bank",
  "card",
  "transfer",
  "adjustment",
]);
export type MovementSourceFilter = z.infer<typeof movementSourceFilterSchema>;
export type MovementTypeFilter = MovementSourceFilter;
export type MovementOrigin =
  | "bank_account"
  | "credit_card"
  | "transfer"
  | "manual_adjustment"
  | "invoice_pdf";
export type CashFlowEffect = "inflow" | "outflow" | "neutral";
export type ConsumptionEffect = "expense" | "income" | "neutral";
export type BankPeriodFilter =
  | "this-month" | "last-month" | "last-30-days" | "last-3-months" | "this-year" | "custom";
export type MovementPeriod = BankPeriodFilter;

export interface MovementFilters {
  search?: string;
  q?: string;
  period?: MovementPeriod | string;
  bill?: string;
  cycle?: string;
  from?: string;
  to?: string;
  account?: string;
  card?: string;
  category?: string;
  status?: string;
  origin?: string;
  type?: MovementSourceFilter | string;
  review?: string;
  ignored?: string;
  uncategorized?: string;
  document?: string;
  minAmount?: string;
  maxAmount?: string;
  page?: string;
  cursor?: string;
  offset?: string;
  tab?: string;
}

export interface MovementFilterState {
  type: MovementTypeFilter;
  bankPeriod: BankPeriodFilter;
  customFrom?: string;
  customTo?: string;
  cycleId?: string;
  billId?: string | null;
  cardId?: string;
  search?: string;
  category?: string;
  page: number;
}

export interface MovementListItem {
  id: string;
  sourceKind: "transaction" | "card_purchase";
  date: string;
  description: string;
  originalDescription: string;
  normalizedDescription: string;
  accountId: string | null;
  accountName: string;
  accountMaskedIdentifier: string | null;
  cardId: string | null;
  instrumentId: string | null;
  source: string;
  direction: MovementDirection;
  movementType: MovementDirection;
  origin: MovementOrigin;
  displayType: string;
  cardLabel: string | null;
  categoryId: string | null;
  categoryName: string;
  amountBrl: number | null;
  amount: number;
  currency: "BRL";
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  exchangeRate: number | null;
  foreignIofAmount: number | null;
  isForeignTransaction: boolean;
  conversionSource: ForeignConversionSource;
  postingDate: string | null;
  convertedAt: string | null;
  status: string;
  reviewRequired: boolean;
  isOwnTransfer: boolean;
  isInvoicePayment: boolean;
  isIgnored: boolean;
  transactionRole: string;
  cashFlowEffect: CashFlowEffect;
  accountCashFlowEffect: CashFlowEffect;
  consumptionEffect: ConsumptionEffect;
  consolidatedFinancialEffect: "inflow" | "outflow" | "none";
  dataCompleteness: "complete" | "partial";
  provider: string;
  externalId: string | null;
  externalIdMasked: string | null;
  invoiceLinked: boolean;
  billId: string | null;
  cycleId: string | null;
  cardEntryType: string | null;
  reconciliationStatus: string | null;
  reconciledSourceIds: string[];
  competenceMonth: string | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  transferLinked: boolean;
  documentLinked: boolean;
  manuallyAdjusted: boolean;
  summaryEffect: "inflow" | "outflow" | "none";
  createdAt: string | null;
  updatedAt: string | null;
  financialNature: string | null;
  financialRole: string | null;
}

export interface MovementPeriodSummary {
  totalInflows: number;
  totalOutflows: number;
  result: number;
  transferVolume: number;
  movementCount: number;
  reviewPendingCount: number;
}

export interface MovementFilterSummary {
  mode: MovementSourceFilter;
  cards: Array<{
    label: string;
    value: number | null;
    tone: "positive" | "negative" | "neutral";
    signed?: boolean;
  }>;
}

const categoryLabels: Record<string, string> = {
  salary: "Salário",
  investment_income: "Rendimentos",
  investment_application: "Aplicações",
  investment_redemption: "Resgates",
  invoice_payment: "Pagamento de cartão",
  transfer_internal: "Transferências",
  transfer_external: "Transferências",
  refund: "Estornos",
  reversal: "Estornos",
  fee: "Tarifas",
  interest: "Juros",
  purchase: "Compras",
  bill_payment: "Contas",
};

const descriptionLabels: Record<string, string> = {
  salary: "Crédito de salário",
  investment_income: "Remuneração de aplicação automática",
  investment_application: "Aplicação financeira",
  investment_redemption: "Resgate de investimento",
  invoice_payment: "Pagamento de fatura",
  transfer_internal: "Transferência entre suas contas",
};

const effectiveStatuses = new Set(["realized", "completed", "posted", "settled", "paid", "received"]);
const legacyFilterAliases: Record<string, MovementSourceFilter> = {
  all: "all",
  bank: "bank",
  cards: "card",
  card: "card",
  transfers: "transfer",
  transfer: "transfer",
  adjustments: "adjustment",
  adjustment: "adjustment",
};

export function parseMovementSourceFilter(
  value: unknown,
  legacyTab?: unknown,
): MovementSourceFilter {
  if (typeof value === "string") {
    const parsed = movementSourceFilterSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return typeof legacyTab === "string"
    ? legacyFilterAliases[legacyTab] ?? "all"
    : "all";
}

export function normalizeMovementFilters(
  filters: MovementFilters,
): MovementFilters & { type: MovementSourceFilter } {
  return normalizeMovementFilterState(filters);
}

const bankPeriodSchema = z.enum([
  "this-month",
  "last-month",
  "last-30-days",
  "last-3-months",
  "this-year",
  "custom",
]);

export function normalizeMovementFilterState(
  filters: MovementFilters,
  cycles: AvailableCardCycle[] = [],
): MovementFilters & { type: MovementSourceFilter } {
  const type = parseMovementSourceFilter(filters.type, filters.tab);
  const bankPeriod = bankPeriodSchema.safeParse(filters.period);
  const normalized: MovementFilters & { type: MovementSourceFilter } = {
    ...filters,
    search: filters.search || filters.q || undefined,
    q: undefined,
    tab: undefined,
    cursor: undefined,
    offset: undefined,
    type,
  };
  if (normalized.card === "all") delete normalized.card;
  if (type === "card") {
    const selected =
      cycles.find(cycle => cycle.cycleId === filters.cycle) ??
      cycles.find(cycle => cycle.billId === filters.bill) ??
      resolveLegacyCardCycle(cycles, filters.cycle) ??
      defaultCardCycle(cycles);
    return {
      ...normalized,
      period: undefined,
      from: undefined,
      to: undefined,
      account: undefined,
      cycle: selected?.cycleId ?? (cycles.length ? undefined : filters.cycle),
      bill: cycles.length ? undefined : filters.bill,
    };
  }
  return {
    ...normalized,
    period: bankPeriod.success ? bankPeriod.data : "this-month",
    bill: undefined,
    cycle: undefined,
    card: type === "all" ? normalized.card : undefined,
  };
}

const obsoleteMovementParams = new Set([
  "tab",
  "source",
  "movementType",
  "cursor",
  "offset",
  "q",
]);

const movementFilterParamOrder: Array<keyof MovementFilters> = [
  "type",
  "cycle",
  "bill",
  "period",
  "from",
  "to",
  "account",
  "card",
  "search",
  "category",
  "origin",
  "status",
  "review",
  "ignored",
  "uncategorized",
  "document",
  "minAmount",
  "maxAmount",
  "page",
  "tab",
  "q",
  "cursor",
  "offset",
];

export function serializeMovementFilters(
  filters: MovementFilters,
  options: { includeObsolete?: boolean } = {},
) {
  const query = new URLSearchParams();
  for (const key of movementFilterParamOrder) {
    const raw = filters[key];
    if (
      raw === undefined ||
      raw === null ||
      raw === "" ||
      raw === "1" && key === "page" ||
      !options.includeObsolete && obsoleteMovementParams.has(key)
    ) {
      continue;
    }
    query.set(key, String(raw));
  }
  return query.toString();
}

export function canonicalizeMovementPath(path: string) {
  const parsed = new URL(path, "https://atlas.local");
  const query = new URLSearchParams();
  for (const [key, value] of parsed.searchParams.entries()) {
    if (!value || key === "page" && value === "1") continue;
    query.append(key, value);
  }
  query.sort();
  const value = query.toString();
  return `${parsed.pathname}${value ? `?${value}` : ""}`;
}

export function currentMovementFiltersPath(filters: MovementFilters) {
  const value = serializeMovementFilters(filters, { includeObsolete: true });
  return `/financeiro/movimentacoes${value ? `?${value}` : ""}`;
}

type MovementRouter = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

export function navigateIfChanged(
  router: MovementRouter,
  currentPath: string,
  nextPath: string,
  method: "push" | "replace" = "replace",
) {
  if (
    canonicalizeMovementPath(currentPath) ===
    canonicalizeMovementPath(nextPath)
  ) {
    return false;
  }
  router[method](nextPath);
  return true;
}

export function buildMovementFiltersUrl(
  filters: MovementFilters,
  patch: Record<string, string | null | undefined> = {},
  options: { preservePage?: boolean } = {},
) {
  const merged = normalizeMovementFilters({ ...filters, ...patch });
  const query = new URLSearchParams(serializeMovementFilters(merged));
  const type = parseMovementSourceFilter(merged.type);
  query.set("type", type);
  if (type === "card") {
    query.delete("period");
    query.delete("from");
    query.delete("to");
    query.delete("account");
    if (query.has("cycle")) query.delete("bill");
  } else {
    query.delete("bill");
    query.delete("cycle");
    if (!query.has("period")) query.set("period", "this-month");
  }
  if (
    !options.preservePage ||
    patch.page === null ||
    query.get("page") === "1"
  ) {
    query.delete("page");
  }
  if (!options.preservePage) {
    query.delete("cursor");
    query.delete("offset");
  }
  const value = serializeMovementFilters(
    Object.fromEntries(query.entries()) as MovementFilters,
  );
  return `/financeiro/movimentacoes${value ? `?${value}` : ""}`;
}

export function buildMovementQueryKey(filters: MovementFilters) {
  const normalized = normalizeMovementFilters(filters);
  return [
    normalized.type,
    normalized.period,
    normalized.from,
    normalized.to,
    normalized.bill,
    normalized.cycle,
    normalized.card,
    normalized.search,
    normalized.category,
    normalized.page,
  ].map(value => value ?? "").join("|");
}

function maskExternalId(value: string | null | undefined) {
  if (!value) return null;
  const suffix = value.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  return suffix ? `••••${suffix}` : null;
}

function normalizedDirection(transaction: FinancialTransaction): MovementDirection {
  if (
    transaction.transaction_role === "transfer" ||
    transaction.transaction_type === "transfer" ||
    transaction.financial_role === "transfer"
  ) return "transfer";
  if (
    transaction.transaction_role === "adjustment" ||
    transaction.source_type === "manual" && transaction.financial_origin === "adjustment"
  ) return "adjustment";
  if (transaction.bank_direction === "inflow") return "inflow";
  if (transaction.bank_direction === "outflow") return "outflow";
  if (transaction.transaction_type === "income" || transaction.transaction_type === "refund") return "inflow";
  return "outflow";
}

function transactionCategory(transaction: FinancialTransaction) {
  const confirmed = transaction.financial_categories?.name?.trim() || null;
  if ((transaction.manually_confirmed || transaction.manual_override_at) && confirmed) return confirmed;
  const internal = categoryLabels[transaction.financial_nature ?? ""];
  if (internal) return internal;
  if (confirmed) return confirmed;
  if (transaction.provider_category?.trim()) return transaction.provider_category.trim();
  return "Sem categoria";
}

function cardCategory(purchase: CardPurchase) {
  const confirmed = purchase.financial_categories?.name?.trim();
  return confirmed || purchase.provider_category?.trim() || "Sem categoria";
}

function accountLabel(account: FinancialAccount | undefined, fallback?: string | null) {
  if (!account) return fallback || "Sem conta";
  return account.institution_name || account.name;
}

export function normalizeFinancialTransaction(
  transaction: FinancialTransaction,
  accounts: FinancialAccount[] = [],
): MovementListItem {
  const bankDirection = normalizedDirection(transaction);
  const nature = transaction.financial_nature ?? transaction.cash_flow_kind ?? null;
  const account = accounts.find(item => item.id === transaction.account_id);
  const isOwnTransfer = bankDirection === "transfer" &&
    Boolean(transaction.transfer_group_id || transaction.destination_account_id);
  const isInvoicePayment = transaction.transaction_role === "invoice_payment" ||
    nature === "invoice_payment";
  const isTransfer = bankDirection === "transfer" ||
    transaction.financial_origin === "transfer";
  const isAdjustment = bankDirection === "adjustment" ||
    transaction.financial_origin === "adjustment";
  const isCardMovement = !isInvoicePayment && (
    transaction.financial_origin === "credit_card" ||
    transaction.source_type === "card" ||
    Boolean(transaction.credit_card_id) ||
    account?.account_type?.toUpperCase() === "CREDIT"
  );
  const isCardRefund = isCardMovement && (
    transaction.transaction_role === "refund" ||
    ["refund", "reversal"].includes(transaction.transaction_type)
  );
  const direction: MovementDirection = isCardMovement
    ? "card"
    : isTransfer
      ? "transfer"
      : isAdjustment
        ? "adjustment"
        : bankDirection;
  const isIgnored = transaction.review_status === "ignored" ||
    ["cancelled", "deleted", "duplicate", "failed", "rejected"].includes(transaction.status);
  const isPrincipalMovement = [
    "investment_application",
    "investment_redemption",
    "investment_contribution",
    "investment_transfer",
    "principal_redemption",
  ].includes(nature ?? "");
  const summaryEffect = isIgnored || isCardMovement || isInvoicePayment ||
    isOwnTransfer || direction === "adjustment" || isPrincipalMovement ||
    !effectiveStatuses.has(transaction.status)
    ? "none"
    : direction === "inflow" ? "inflow" : direction === "outflow" ? "outflow" : "none";
  const resolvedAccountDirection = resolveBankTransactionDirection(
    transaction,
    transaction.account_id ?? undefined,
  );
  const accountCashFlowEffect: CashFlowEffect = isCardMovement
    ? "neutral"
    : resolvedAccountDirection === "inflow"
      ? "inflow"
      : resolvedAccountDirection === "outflow"
        ? "outflow"
        : "neutral";
  const description = descriptionLabels[nature ?? ""] ||
    descriptionLabels[transaction.transaction_role] ||
    transaction.description;
  const linkedCardLabel = transaction.credit_cards?.name?.trim() || null;
  const cardLabel = isCardMovement
    ? linkedCardLabel ||
      account?.name ||
      transaction.financial_accounts?.name ||
      "Cartão de crédito"
    : null;
  const lastFour = transaction.credit_cards?.last_four_digits ?? null;
  const foreign = normalizeForeignCardMovement({
    persistedAmountBrl: transaction.amount_brl,
    manualAmountBrl:
      transaction.conversion_source === "manual"
        ? transaction.amount_brl
        : null,
    pdfAmountBrl:
      transaction.conversion_source === "pdf"
        ? transaction.amount_brl
        : null,
    amount: transaction.amount,
    originalAmount: transaction.original_amount,
    originalCurrencyCode:
      transaction.original_currency_code ?? transaction.original_currency,
    exchangeRate: transaction.exchange_rate,
    iofAmountBrl: transaction.foreign_iof_amount,
    conversionSource: transaction.conversion_source,
    source: transaction.source,
    description: transaction.description,
  });
  const hasCoreData = Boolean(transaction.id && transaction.competence_date) &&
    Number.isFinite(Number(transaction.amount));
  const hasKnownTarget = isCardMovement
    ? Boolean(transaction.credit_card_id || linkedCardLabel || account)
    : Boolean(transaction.account_id || account || transaction.financial_accounts);
  const origin: MovementOrigin = isCardMovement
    ? "credit_card"
    : isTransfer
      ? "transfer"
      : isAdjustment
        ? "manual_adjustment"
        : "bank_account";
  return {
    id: transaction.id,
    sourceKind: "transaction",
    date: bankMovementDate(transaction) ?? transaction.competence_date,
    description,
    originalDescription: transaction.description,
    normalizedDescription: description,
    accountId: transaction.account_id,
    accountName: cardLabel ?? accountLabel(account, transaction.financial_accounts?.institution_name ||
      transaction.financial_accounts?.name),
    accountMaskedIdentifier: lastFour ? `final ${lastFour}` : null,
    cardId: transaction.credit_card_id ?? null,
    instrumentId: null,
    source: transaction.source_type,
    direction,
    movementType: direction,
    origin,
    displayType: isCardMovement
      ? isCardRefund ? "Crédito/estorno no cartão" : "Compra no cartão"
      : isInvoicePayment
        ? "Saída da conta"
        : isTransfer
          ? "Transferência"
          : direction === "adjustment"
            ? "Ajuste"
            : direction === "inflow"
              ? "Entrada na conta"
              : "Saída da conta",
    cardLabel,
    categoryId: transaction.category_id,
    categoryName: transactionCategory(transaction),
    amountBrl: foreign.amountBrl,
    amount: foreign.amountBrl ?? 0,
    currency: "BRL",
    originalAmount: foreign.originalAmount,
    originalCurrencyCode: foreign.originalCurrencyCode,
    exchangeRate: foreign.exchangeRate,
    foreignIofAmount: foreign.iofAmountBrl,
    isForeignTransaction: foreign.isForeignTransaction,
    conversionSource: foreign.conversionSource,
    postingDate: transaction.provider_posted_at?.slice(0, 10) ?? null,
    convertedAt: transaction.converted_at ?? null,
    status: transaction.status,
    reviewRequired: transaction.review_status === "pending" ||
      transaction.bank_direction === "review",
    isOwnTransfer,
    isInvoicePayment,
    isIgnored,
    transactionRole: transaction.transaction_role,
    cashFlowEffect: accountCashFlowEffect,
    accountCashFlowEffect,
    consumptionEffect: isInvoicePayment || isOwnTransfer || isPrincipalMovement
      ? "neutral"
      : isCardRefund ? "income"
      : isCardMovement || transaction.financial_role === "expense" ? "expense"
      : transaction.financial_role === "revenue" ? "income" : "neutral",
    consolidatedFinancialEffect: summaryEffect,
    dataCompleteness:
      hasCoreData &&
      hasKnownTarget &&
      (!foreign.isForeignTransaction || foreign.amountBrl !== null)
        ? "complete"
        : "partial",
    provider: transaction.source === "pluggy" ? "Pluggy" : "Manual",
    externalId: transaction.external_id ?? null,
    externalIdMasked: maskExternalId(transaction.external_id),
    invoiceLinked: Boolean(transaction.invoice_id),
    billId: transaction.invoice_id ?? null,
    cycleId: null,
    cardEntryType: null,
    reconciliationStatus: null,
    reconciledSourceIds: [],
    competenceMonth: null,
    installmentNumber: null,
    installmentTotal: null,
    transferLinked: Boolean(transaction.transfer_group_id),
    documentLinked: Boolean(transaction.invoice_id),
    manuallyAdjusted: Boolean(transaction.manual_override_at || transaction.manually_confirmed),
    summaryEffect,
    createdAt: transaction.created_at ?? null,
    updatedAt: transaction.manual_override_at ?? transaction.created_at ?? null,
    financialNature: nature,
    financialRole: transaction.financial_role ?? null,
  };
}

export function normalizeCardPurchase(purchase: CardPurchase): MovementListItem {
  const isIgnored = purchase.review_status === "ignored" || purchase.status === "cancelled";
  const isRefund = ["refund", "adjustment"].includes(purchase.transaction_role) ||
    Number(purchase.installment_amount) < 0;
  const accountName = purchase.credit_cards?.name || "Cartão";
  const cardDisplayLabel =
    purchase.credit_cards?.name ||
    purchase.credit_card_instruments?.display_name ||
    accountName;
  const lastFour = purchase.credit_cards?.last_four_digits ??
    purchase.credit_card_instruments?.last_four_digits ?? null;
  const foreign = normalizeForeignCardMovement({
    persistedAmountBrl: purchase.amount_brl,
    pdfAmountBrl:
      purchase.conversion_source === "pdf"
        ? purchase.amount_brl
        : null,
    manualAmountBrl:
      purchase.conversion_source === "manual"
        ? purchase.amount_brl
        : null,
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
  return {
    id: purchase.id,
    sourceKind: "card_purchase",
    date: purchase.competence_date || purchase.purchase_date,
    description: purchase.description,
    originalDescription: purchase.description,
    normalizedDescription: purchase.merchant || purchase.description,
    accountId: null,
    accountName: cardDisplayLabel,
    accountMaskedIdentifier: lastFour ? `final ${lastFour}` : null,
    cardId: purchase.card_id,
    instrumentId: purchase.instrument_id ?? null,
    source: purchase.source_type,
    direction: "card",
    movementType: "card",
    origin: "credit_card",
    displayType: isRefund ? "Crédito/estorno no cartão" : "Compra no cartão",
    cardLabel: cardDisplayLabel,
    categoryId: purchase.category_id,
    categoryName: cardCategory(purchase),
    amountBrl: foreign.amountBrl,
    amount: foreign.amountBrl ?? 0,
    currency: "BRL",
    originalAmount: foreign.originalAmount,
    originalCurrencyCode: foreign.originalCurrencyCode,
    exchangeRate: foreign.exchangeRate,
    foreignIofAmount: foreign.iofAmountBrl,
    isForeignTransaction: foreign.isForeignTransaction,
    conversionSource: foreign.conversionSource,
    postingDate: purchase.posting_date ?? null,
    convertedAt: purchase.converted_at ?? null,
    status: purchase.status,
    reviewRequired: purchase.review_status === "pending" || !purchase.card_id,
    isOwnTransfer: false,
    isInvoicePayment: false,
    isIgnored,
    transactionRole: isRefund ? "refund" : purchase.transaction_role,
    cashFlowEffect: "neutral",
    accountCashFlowEffect: "neutral",
    consumptionEffect: isRefund ? "income" : "expense",
    consolidatedFinancialEffect: "none",
    dataCompleteness:
      purchase.card_id && purchase.purchase_date &&
      Number.isFinite(Number(purchase.installment_amount)) &&
      (!foreign.isForeignTransaction || foreign.amountBrl !== null)
        ? "complete"
        : "partial",
    provider:
      purchase.source === "pluggy"
        ? "Pluggy"
        : purchase.source === "pdf"
          ? "PDF"
          : purchase.source === "projection"
            ? "Projeção"
            : "Manual",
    externalId: purchase.external_id ?? null,
    externalIdMasked: maskExternalId(purchase.external_id),
    invoiceLinked: Boolean(purchase.invoice_id || purchase.provider_bill_id),
    billId: purchase.invoice_id ?? null,
    cycleId: purchase.cycle_id ?? null,
    cardEntryType: purchase.entry_type ?? null,
    reconciliationStatus: purchase.reconciliation_status ?? null,
    reconciledSourceIds: purchase.reconciled_source_ids ?? [],
    competenceMonth: purchase.competence_month ?? null,
    installmentNumber: purchase.installment_number,
    installmentTotal: purchase.installment_count,
    transferLinked: false,
    documentLinked: purchase.source === "pdf",
    manuallyAdjusted: purchase.installment_manually_confirmed === true,
    summaryEffect: "none",
    createdAt: purchase.created_at ?? null,
    updatedAt: purchase.created_at ?? null,
    financialNature: isRefund ? "refund" : "purchase",
    financialRole: purchase.transaction_role,
  };
}

export function normalizeMovementListItem(
  movement: FinancialTransaction | CardPurchase,
  accounts: FinancialAccount[] = [],
): MovementListItem {
  return "card_id" in movement
    ? normalizeCardPurchase(movement)
    : normalizeFinancialTransaction(movement, accounts);
}

export function calculateMovementPeriodSummary(items: MovementListItem[]): MovementPeriodSummary {
  return calculateFinancialAnalysis(items);
}

export function calculateFinancialAnalysis(
  items: MovementListItem[],
): MovementPeriodSummary {
  let totalInflows = 0;
  let totalOutflows = 0;
  let transferVolume = 0;
  let reviewPendingCount = 0;
  for (const item of items) {
    if (item.consolidatedFinancialEffect === "inflow") totalInflows += item.amount;
    if (item.consolidatedFinancialEffect === "outflow") totalOutflows += item.amount;
    if (item.direction === "transfer") transferVolume += item.amount;
    if (item.reviewRequired) reviewPendingCount += 1;
  }
  return {
    totalInflows,
    totalOutflows,
    result: totalInflows - totalOutflows,
    transferVolume,
    movementCount: items.length,
    reviewPendingCount,
  };
}

export function calculateMovementBankAccountCashFlow(
  items: MovementListItem[],
): BankAccountCashFlowSummary {
  return summarizeBankAccountCashFlow(items.map(item => ({
    id: item.id,
    date: item.date,
    amount: item.amount,
    effect: item.accountCashFlowEffect,
    included:
      !item.isIgnored &&
      effectiveStatuses.has(item.status) &&
      item.origin !== "credit_card",
  })));
}

export function calculateMovementSummaryByFilter(
  items: MovementListItem[],
  filter: MovementSourceFilter,
  cycle?: AvailableCardCycle | null,
): MovementFilterSummary {
  if (filter === "card") {
    const launchedPurchases = items
      .filter(item => item.consumptionEffect === "expense" && !item.isIgnored)
      .filter(item => item.reconciliationStatus !== "projected_only")
      .reduce((sum, item) => sum + item.amount, 0);
    const projectedInstallments = items
      .filter(item =>
        item.consumptionEffect === "expense" &&
        !item.isIgnored &&
        item.reconciliationStatus === "projected_only")
      .reduce((sum, item) => sum + item.amount, 0);
    const credits = items
      .filter(item => item.consumptionEffect === "income" && !item.isIgnored)
      .reduce((sum, item) => sum + item.amount, 0);
    const purchasesAndCharges = launchedPurchases + projectedInstallments;
    const projection = purchasesAndCharges - credits;
    if (
      cycle?.officialTotal !== null &&
      cycle?.officialTotal !== undefined &&
      ["closed", "paid"].includes(cycle.kind)
    ) {
      return {
        mode: filter,
        cards: [
          { label: "Total oficial", value: cycle.officialTotal, tone: "neutral" },
          {
            label: "Compras e encargos",
            value: purchasesAndCharges,
            tone: "negative",
          },
          {
            label: "Créditos e estornos",
            value: credits,
            tone: "positive",
          },
        ],
      };
    }
    const reliableProjection = items.length
      ? projection
      : cycle?.lastReliableTotal ?? null;
    return {
      mode: filter,
      cards: [
        {
          label: "Compras lançadas",
          value: items.length ? launchedPurchases : null,
          tone: "negative",
        },
        {
          label: "Parcelas comprometidas",
          value: items.length ? projectedInstallments : null,
          tone: "negative",
        },
        {
          label: "Projeção atual",
          value: reliableProjection,
          tone: reliableProjection !== null && reliableProjection > 0
            ? "negative"
            : reliableProjection !== null && reliableProjection < 0
              ? "positive"
              : "neutral",
        },
      ],
    };
  }
  if (filter === "transfer") {
    const sent = items.filter(item => item.cashFlowEffect === "outflow")
      .reduce((sum, item) => sum + item.amount, 0);
    const received = items.filter(item => item.cashFlowEffect === "inflow")
      .reduce((sum, item) => sum + item.amount, 0);
    return {
      mode: filter,
      cards: [
        { label: "Enviado", value: -sent, tone: "negative" },
        { label: "Recebido", value: received, tone: "positive" },
        { label: "Volume movimentado", value: sent + received, tone: "neutral" },
      ],
    };
  }
  if (filter === "adjustment") {
    const positives = items.filter(item => item.cashFlowEffect === "inflow")
      .reduce((sum, item) => sum + item.amount, 0);
    const negatives = items.filter(item => item.cashFlowEffect === "outflow")
      .reduce((sum, item) => sum + item.amount, 0);
    return {
      mode: filter,
      cards: [
        { label: "Ajustes positivos", value: positives, tone: "positive" },
        { label: "Ajustes negativos", value: -negatives, tone: "negative" },
        {
          label: "Líquido",
          value: positives - negatives,
          tone: positives - negatives > 0 ? "positive" : positives - negatives < 0 ? "negative" : "neutral",
          signed: true,
        },
      ],
    };
  }
  const cash = calculateMovementBankAccountCashFlow(items);
  return {
    mode: filter,
    cards: [
      { label: "Entradas", value: cash.totalInflows, tone: "positive" },
      { label: "Saídas", value: cash.totalOutflows, tone: "negative" },
      {
        label: "Resultado",
        value: cash.netMovement,
        tone: cash.netMovement > 0 ? "positive" : cash.netMovement < 0 ? "negative" : "neutral",
        signed: true,
      },
    ],
  };
}

export function resolveMovementPeriod(
  filters: MovementFilters,
  now = new Date(),
) {
  const period = filters.period || "this-month";
  const year = now.getFullYear();
  const month = now.getMonth();
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  if (period === "custom" && filters.from && filters.to) {
    return { from: filters.from, to: filters.to };
  }
  if (period === "last-month") {
    return {
      from: iso(new Date(year, month - 1, 1)),
      to: iso(new Date(year, month, 0)),
    };
  }
  if (period === "last-30-days") {
    const start = new Date(year, month, now.getDate() - 29);
    return { from: iso(start), to: iso(now) };
  }
  if (period === "last-3-months") {
    return { from: iso(new Date(year, month - 2, 1)), to: iso(now) };
  }
  if (period === "this-year") {
    return { from: `${year}-01-01`, to: iso(now) };
  }
  return {
    from: iso(new Date(year, month, 1)),
    to: iso(new Date(year, month + 1, 0)),
  };
}

export function matchesMovement(
  item: MovementListItem,
  filters: MovementFilters,
  selectedCycle?: AvailableCardCycle | null,
) {
  const type = parseMovementSourceFilter(filters.type, filters.tab);
  const range = type === "card" && selectedCycle
    ? {
        from: selectedCycle.cycleStartDate,
        to: selectedCycle.cycleEndDate,
      }
    : resolveMovementPeriod(filters);
  const outsideSelectedCycle =
    type === "card" &&
    selectedCycle &&
    (
      item.cycleId
        ? item.cycleId !== selectedCycle.cycleId
        : selectedCycle.billId && item.billId
          ? item.billId !== selectedCycle.billId
          : item.date < range.from || item.date > range.to
    );
  const search = (filters.search || filters.q || "").trim().toLocaleLowerCase("pt-BR");
  const searchable = [
    item.description,
    item.originalDescription,
    item.normalizedDescription,
    item.categoryName,
    item.accountName,
    item.provider,
    item.amountBrl === null ? "" : formatCurrency(item.amountBrl),
    item.originalCurrencyCode ?? "",
    item.originalAmount !== null && item.originalCurrencyCode
      ? formatMoneyByCurrency(
        item.originalAmount,
        item.originalCurrencyCode,
      )
      : "",
    item.originalAmount !== null
      ? item.originalAmount.toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
      : "",
  ].join(" ").toLocaleLowerCase("pt-BR");
  const minAmount = Number(String(filters.minAmount ?? "").replace(",", "."));
  const maxAmount = Number(String(filters.maxAmount ?? "").replace(",", "."));
  return !(
    outsideSelectedCycle ||
    type !== "card" && (item.date < range.from || item.date > range.to) ||
    search && !searchable.includes(search) ||
    filters.account && item.accountId !== filters.account ||
    filters.card && (item.instrumentId ?? item.cardId) !== filters.card ||
    filters.category && item.categoryId !== filters.category ||
    filters.status && item.status !== filters.status ||
    filters.origin && item.provider.toLowerCase() !== filters.origin.toLowerCase() &&
      item.source !== filters.origin ||
    filters.review === "pending" && !item.reviewRequired ||
    filters.ignored === "true" && !item.isIgnored ||
    filters.uncategorized === "true" && item.categoryName !== "Sem categoria" ||
    filters.document === "linked" && !item.documentLinked ||
    Number.isFinite(minAmount) && filters.minAmount !== undefined && item.amount < minAmount ||
    Number.isFinite(maxAmount) && filters.maxAmount !== undefined && item.amount > maxAmount ||
    type === "bank" &&
      !(
        item.origin === "bank_account" ||
        item.accountId && item.accountCashFlowEffect !== "neutral"
      ) ||
    type === "card" && item.origin !== "credit_card" ||
    type === "transfer" && item.origin !== "transfer" ||
    type === "adjustment" && item.origin !== "manual_adjustment"
  );
}

export function deduplicateMovements(items: MovementListItem[]) {
  const priority = (item: MovementListItem) =>
    item.documentLinked ? 3 : item.sourceKind === "card_purchase" ? 2 : 1;
  const byFingerprint = new Map<string, MovementListItem>();
  for (const item of items) {
    const fingerprint = item.externalId
      ? `external|${item.source}|${item.externalId}`
      : [
          item.origin,
          item.cardId ?? item.accountId ?? item.accountName,
          item.date,
          item.amount.toFixed(2),
          item.normalizedDescription.trim().toLocaleUpperCase("pt-BR"),
        ].join("|");
    const current = byFingerprint.get(fingerprint);
    if (!current || priority(item) > priority(current)) {
      byFingerprint.set(fingerprint, item);
    }
  }
  return [...byFingerprint.values()];
}

export function groupMovementsByDate(items: MovementListItem[]) {
  return items.reduce<Record<string, MovementListItem[]>>((groups, item) => {
    (groups[item.date] ??= []).push(item);
    return groups;
  }, {});
}

export function legacyTabType(tab?: string) {
  return tab ? legacyFilterAliases[tab] ?? null : null;
}

export function matchesTransaction(item: FinancialTransaction, filters: MovementFilters) {
  return matchesMovement(normalizeFinancialTransaction(item), filters);
}

export function matchesCardPurchase(item: CardPurchase, filters: MovementFilters) {
  return matchesMovement(normalizeCardPurchase(item), filters);
}

export function movementKind(item: FinancialTransaction | CardPurchase) {
  if ("card_id" in item) return "card";
  return normalizeFinancialTransaction(item).movementType === "adjustment"
    ? "adjustment"
    : normalizeFinancialTransaction(item).movementType;
}
