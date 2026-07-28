export type ForeignConversionSource =
  | "pdf"
  | "pluggy"
  | "manual"
  | "derived"
  | "unknown";

export type NormalizedForeignCardMovement = {
  displayAmountBrl: number | null;
  amountBrl: number | null;
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  exchangeRate: number | null;
  iofAmountBrl: number | null;
  isForeignTransaction: boolean;
  conversionSource: ForeignConversionSource;
};

export type ForeignCardMovementInput = {
  amountBrl?: unknown;
  pdfAmountBrl?: unknown;
  providerAmountBrl?: unknown;
  manualAmountBrl?: unknown;
  persistedAmountBrl?: unknown;
  amount?: unknown;
  amountInAccountCurrency?: unknown;
  originalAmount?: unknown;
  originalCurrencyCode?: unknown;
  currencyCode?: unknown;
  exchangeRate?: unknown;
  iofAmountBrl?: unknown;
  conversionSource?: unknown;
  source?: unknown;
  description?: unknown;
};

const conversionSources = new Set<ForeignConversionSource>([
  "pdf",
  "pluggy",
  "manual",
  "derived",
  "unknown",
]);

function finitePositive(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function finiteAbsolute(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number !== 0 ? Math.abs(number) : null;
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function decimal(value: number, scale: number) {
  const factor = 10 ** scale;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function normalizeCurrencyCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function explicitDescriptionCurrency(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.toUpperCase().match(
    /(?:^|\s)(US\$|USD|€|EUR)\s*([0-9]+(?:[.,][0-9]{1,2})?)(?:\s|$)/,
  );
  if (!match) return null;
  const amount = finitePositive(
    match[2].includes(",")
      ? match[2].replace(/\./g, "").replace(",", ".")
      : match[2],
  );
  if (amount === null) return null;
  return {
    amount,
    currencyCode: match[1] === "US$" || match[1] === "USD" ? "USD" : "EUR",
  };
}

export function normalizeCardMovementAmounts(
  input: ForeignCardMovementInput,
): NormalizedForeignCardMovement {
  const source = typeof input.conversionSource === "string"
    ? input.conversionSource
    : null;
  const legacyExplicitBrl = finiteAbsolute(input.amountBrl);
  const pdfAmountBrl = finiteAbsolute(input.pdfAmountBrl) ??
    (source === "pdf" ? legacyExplicitBrl : null);
  const providerAmountBrl = finiteAbsolute(input.providerAmountBrl) ??
    finiteAbsolute(input.amountInAccountCurrency);
  const manualAmountBrl = finiteAbsolute(input.manualAmountBrl) ??
    (source === "manual" ? legacyExplicitBrl : null);
  const persistedAmountBrl = finiteAbsolute(input.persistedAmountBrl) ??
    (!["pdf", "manual"].includes(source ?? "") ? legacyExplicitBrl : null);
  const accountCurrencyAmount = finiteAbsolute(input.amountInAccountCurrency);
  const fallbackAmount = finiteAbsolute(input.amount);
  const structuredOriginal = finitePositive(input.originalAmount);
  const structuredOriginalCurrency =
    normalizeCurrencyCode(input.originalCurrencyCode);
  const transactionCurrency = normalizeCurrencyCode(input.currencyCode);
  const foreignTransactionCurrency =
    transactionCurrency && transactionCurrency !== "BRL"
      ? transactionCurrency
      : null;
  const derivedFromDescription =
    !structuredOriginal || !structuredOriginalCurrency
      ? explicitDescriptionCurrency(input.description)
      : null;
  const originalAmount =
    structuredOriginal ??
    (foreignTransactionCurrency ? finiteAbsolute(input.amount) : null) ??
    derivedFromDescription?.amount ??
    null;
  const originalCurrencyCode =
    structuredOriginalCurrency ??
    foreignTransactionCurrency ??
    derivedFromDescription?.currencyCode ??
    null;
  const isForeignTransaction = Boolean(
    originalAmount &&
    originalCurrencyCode &&
    originalCurrencyCode !== "BRL",
  );
  const explicitRate = finitePositive(input.exchangeRate);
  const exchangeRate = explicitRate === null ? null : decimal(explicitRate, 8);
  const iof = finitePositive(input.iofAmountBrl);
  const suspiciousPersistedAmount = Boolean(
    isForeignTransaction &&
    persistedAmountBrl !== null &&
    originalAmount !== null &&
    Math.abs(persistedAmountBrl - originalAmount) <= 0.001 &&
    !["pdf", "manual", "pluggy"].includes(source ?? ""),
  );
  const derivedAmountBrl =
    isForeignTransaction && exchangeRate !== null && originalAmount !== null
      ? money(originalAmount * exchangeRate)
      : null;
  const selectedAmount = isForeignTransaction
    ? [
        ["pdf", pdfAmountBrl],
        ["pluggy", providerAmountBrl ?? accountCurrencyAmount],
        ["manual", manualAmountBrl],
        ["persisted", suspiciousPersistedAmount ? null : persistedAmountBrl],
        ["derived", derivedAmountBrl],
      ].find((candidate): candidate is [string, number] =>
        candidate[1] !== null)
    : ["national", legacyExplicitBrl ?? persistedAmountBrl ?? fallbackAmount] as
      [string, number | null];
  const amountBrl = selectedAmount?.[1] === null ||
      selectedAmount?.[1] === undefined
    ? null
    : money(selectedAmount[1]);
  const requestedSource =
    typeof input.conversionSource === "string" &&
    conversionSources.has(input.conversionSource as ForeignConversionSource)
      ? input.conversionSource as ForeignConversionSource
      : null;
  const conversionSource: ForeignConversionSource =
    selectedAmount?.[0] === "pdf"
      ? "pdf"
      : selectedAmount?.[0] === "pluggy"
        ? "pluggy"
        : selectedAmount?.[0] === "manual"
          ? "manual"
          : selectedAmount?.[0] === "derived"
            ? "derived"
            : requestedSource ??
    (input.source === "pdf"
      ? "pdf"
      : input.source === "manual"
        ? "manual"
        : "unknown");
  return {
    displayAmountBrl: amountBrl,
    amountBrl,
    originalAmount: isForeignTransaction ? money(originalAmount!) : null,
    originalCurrencyCode: isForeignTransaction
      ? originalCurrencyCode
      : null,
    exchangeRate,
    iofAmountBrl: iof === null ? null : money(iof),
    isForeignTransaction,
    conversionSource,
  };
}

export const normalizeForeignCardMovement = normalizeCardMovementAmounts;

export function persistedCardMovementAmountBrl(input: {
  amount_brl?: unknown;
  installment_amount?: unknown;
  original_amount?: unknown;
  original_currency_code?: unknown;
  currency?: unknown;
  exchange_rate?: unknown;
  conversion_source?: unknown;
  source?: unknown;
  description?: unknown;
  provider_metadata?: Record<string, unknown> | null;
}) {
  return normalizeCardMovementAmounts({
    persistedAmountBrl: input.amount_brl,
    pdfAmountBrl:
      input.conversion_source === "pdf" ? input.amount_brl : null,
    manualAmountBrl:
      input.conversion_source === "manual" ? input.amount_brl : null,
    providerAmountBrl:
      input.provider_metadata?.amountInAccountCurrency ??
      input.provider_metadata?.convertedAmount ??
      input.provider_metadata?.localAmount,
    amount: input.installment_amount,
    originalAmount: input.original_amount,
    originalCurrencyCode: input.original_currency_code,
    currencyCode: input.currency,
    exchangeRate: input.exchange_rate,
    conversionSource: input.conversion_source,
    source: input.source,
    description: input.description,
  }).amountBrl;
}

export function implicitExchangeRate(
  value: Pick<
    NormalizedForeignCardMovement,
    "amountBrl" | "originalAmount" | "isForeignTransaction"
  >,
) {
  if (
    !value.isForeignTransaction ||
    !value.originalAmount ||
    value.originalAmount <= 0 ||
    value.amountBrl === null ||
    value.amountBrl <= 0
  ) return null;
  return Math.round((value.amountBrl / value.originalAmount) * 10_000) / 10_000;
}

export function formatMoneyByCurrency(
  amount: number,
  currencyCode: string,
) {
  const currency = normalizeCurrencyCode(currencyCode) ?? "BRL";
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  }
}
