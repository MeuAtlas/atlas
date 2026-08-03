import type { PluggyTransaction } from "./types";

export const BANK_CLASSIFIER_VERSION = "bank_classifier_v2";

export type BankDirection = "inflow" | "outflow" | "neutral" | "review";
export type FinancialNature =
  | "salary"
  | "pix_received"
  | "pix_sent"
  | "investment_income"
  | "investment_application"
  | "investment_redemption"
  | "loan_proceeds"
  | "financing_payment"
  | "debt_payment"
  | "invoice_payment"
  | "transfer_internal"
  | "transfer_external"
  | "refund"
  | "reversal"
  | "fee"
  | "interest"
  | "purchase"
  | "bill_payment"
  | "other";
export type FinancialRole =
  | "revenue"
  | "expense"
  | "cash_flow_only"
  | "transfer"
  | "debt_proceeds"
  | "debt_payment"
  | "investment_principal"
  | "correction"
  | "pending_review";
export type ClassificationSource =
  | "provider_structured"
  | "provider_sign"
  | "description_assisted"
  | "manual";
export type ClassificationConfidence = "high" | "medium" | "low";

export type BankClassification = {
  bank_direction: BankDirection;
  financial_nature: FinancialNature;
  financial_role: FinancialRole;
  classification_source: ClassificationSource;
  classification_confidence: ClassificationConfidence;
  classification_rule: string;
  classification_version: typeof BANK_CLASSIFIER_VERSION;
  transaction_type: "income" | "expense" | "transfer" | "refund" | "adjustment";
  transaction_role:
    | "cash_flow"
    | "invoice_payment"
    | "transfer"
    | "refund"
    | "adjustment";
  financial_origin:
    | "bank_account"
    | "invoice"
    | "transfer"
    | "adjustment";
  cash_flow_kind: string;
  suspected_transfer: boolean;
  review_status: "pending" | "reviewed";
};

function normalized(...values: unknown[]) {
  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[_-]+/g, " ")
    .toUpperCase();
}

function operationType(transaction: PluggyTransaction) {
  return normalized(
    transaction.operationType,
    transaction.operationTypeAdditionalInfo,
  );
}

export function providerBankDirection(
  transaction: Pick<PluggyTransaction, "type" | "amount">,
) {
  const providerType = normalized(transaction.type).trim();
  const amount = Number(transaction.amount ?? 0);
  if (providerType === "CREDIT") return "inflow" as const;
  if (providerType === "DEBIT") return "outflow" as const;
  if (amount > 0) return "inflow" as const;
  if (amount < 0) return "outflow" as const;
  return "review" as const;
}

function legacy(
  direction: BankDirection,
  nature: FinancialNature,
  role: FinancialRole,
) {
  if (role === "transfer") {
    return {
      transaction_type: "transfer",
      transaction_role: "transfer",
      financial_origin: "transfer",
      cash_flow_kind: nature,
    } as const;
  }
  if (role === "investment_principal") {
    return {
      transaction_type: direction === "inflow" ? "income" : "expense",
      transaction_role: "adjustment",
      financial_origin: "adjustment",
      cash_flow_kind:
        nature === "investment_redemption"
          ? "investment_redemption"
          : "investment_contribution",
    } as const;
  }
  if (role === "correction") {
    return {
      transaction_type: "refund",
      transaction_role: "refund",
      financial_origin: "adjustment",
      cash_flow_kind: "refund",
    } as const;
  }
  if (nature === "invoice_payment") {
    return {
      transaction_type: "transfer",
      transaction_role: "invoice_payment",
      financial_origin: "invoice",
      cash_flow_kind: "invoice_payment",
    } as const;
  }
  return {
    transaction_type: direction === "inflow" ? "income" : "expense",
    transaction_role: "cash_flow",
    financial_origin: "bank_account",
    cash_flow_kind:
      nature === "loan_proceeds"
        ? "loan_proceeds"
        : nature === "financing_payment" || nature === "debt_payment"
          ? nature
          : role === "revenue"
            ? "income"
            : role === "expense"
              ? "expense"
              : "cash_flow_only",
  } as const;
}

export function classifyBankTransaction(
  transaction: PluggyTransaction,
  options: { internalTransfer?: boolean } = {},
): BankClassification {
  const direction = providerBankDirection(transaction);
  const providerType = normalized(transaction.type).trim();
  const operation = operationType(transaction);
  const clue = normalized(
    transaction.category,
    transaction.description,
    transaction.operationTypeAdditionalInfo,
  );
  const amount = Number(transaction.amount ?? 0);
  const typeSignConflict =
    (providerType === "CREDIT" && amount < 0) ||
    (providerType === "DEBIT" && amount > 0);
  const structuredDirection =
    providerType === "CREDIT" || providerType === "DEBIT";
  const source: ClassificationSource = structuredDirection
    ? "provider_structured"
    : "provider_sign";
  const baseConfidence: ClassificationConfidence = typeSignConflict
    ? "medium"
    : structuredDirection
      ? "high"
      : direction === "review"
        ? "low"
        : "medium";
  let classificationSource: ClassificationSource = source;

  let nature: FinancialNature = "other";
  let role: FinancialRole =
    direction === "inflow"
      ? "revenue"
      : direction === "outflow"
        ? "expense"
        : "pending_review";
  let rule = "bank.default_by_structured_direction";
  let reviewStatus: "pending" | "reviewed" =
    direction === "review" ? "pending" : "reviewed";

  if (options.internalTransfer) {
    nature = "transfer_internal";
    role = "transfer";
    rule = "bank.internal_transfer.matched_counterpart";
  } else if (
    /(?:PAGAMENTO|PGTO).*(?:FATURA|CARTAO.*(?:CREDITO|MASTER|VISA))|FATURA.*PAGAMENTO|CREDIT CARD PAYMENT/.test(
      clue,
    )
  ) {
    nature = "invoice_payment";
    role = "cash_flow_only";
    rule = "bank.invoice_payment.description_assisted";
    classificationSource = "description_assisted";
    reviewStatus = "pending";
  } else if (/ESTORNO|REEMBOLSO|REFUND|CHARGEBACK/.test(clue)) {
    nature = "refund";
    role = "correction";
    rule = "bank.refund.description_assisted";
    classificationSource = "description_assisted";
  } else if (
    direction === "inflow" &&
    (/RENDIMENTO APLIC FINANCEIRA/.test(operation) ||
      /REMUNERACAO (APLIC|CONTA)|RENDIMENTO (APLIC|AUTOMATIC)|JUROS APLIC|RENTABILIDADE|INCOME DISTRIBUTION|DIVIDENDO/.test(
        clue,
      ))
  ) {
    nature = "investment_income";
    role = "revenue";
    rule = operation.includes("RENDIMENTO APLIC FINANCEIRA")
      ? "bank.investment_income.operation_type"
      : "bank.investment_income.description_assisted";
    if (!operation.includes("RENDIMENTO APLIC FINANCEIRA")) {
      classificationSource = "description_assisted";
    }
  } else if (
    direction === "outflow" &&
    (/APLIC(ACAO)? FINANCEIRA|INVESTMENT CONTRIBUTION/.test(operation) ||
      /APLICACAO|APORTE|TRANSFER.*INVEST/.test(clue))
  ) {
    nature = "investment_application";
    role = "investment_principal";
    rule = "bank.investment_application";
  } else if (
    direction === "inflow" &&
    (/RESGATE APLIC FINANCEIRA|INVESTMENT REDEMPTION/.test(operation) ||
      /RESGATE.*INVEST/.test(clue))
  ) {
    nature = "investment_redemption";
    role = "investment_principal";
    rule = "bank.investment_redemption";
  } else if (
    direction === "outflow" &&
    /PREST CR IM|PRESTACAO CREDITO IMOBILIARIO|FINANCIAMENTO IMOBILIARIO|PARCELA FINANCIAMENTO|CREDITO IMOBILIARIO PREST|\bCR IM\b|PREST HABITACIONAL/.test(
      clue,
    )
  ) {
    nature = "financing_payment";
    role = "debt_payment";
    rule = "bank.financing_payment.debit_description";
    classificationSource = "description_assisted";
  } else if (
    direction === "inflow" &&
    (/CREDITO DE SALARIO|SALARIO/.test(clue) ||
      /SALARY/.test(operation))
  ) {
    nature = "salary";
    role = "revenue";
    rule = "bank.salary";
    if (!/SALARY/.test(operation)) classificationSource = "description_assisted";
  } else if (
    direction === "inflow" &&
    (/OPERACAO CREDITO/.test(operation) ||
      /EMPRESTIMO|CREDITO CONSIGNADO|LOAN PROCEEDS|FINANCIAMENTO LIBERADO|LIBERACAO.*CREDITO/.test(
        clue,
      ))
  ) {
    nature = "loan_proceeds";
    role = "debt_proceeds";
    rule = "bank.loan_proceeds.credit";
    if (!/OPERACAO CREDITO/.test(operation)) {
      classificationSource = "description_assisted";
    }
  } else if (/\bPIX\b/.test(operation) || /\bPIX\b/.test(clue)) {
    nature = direction === "inflow" ? "pix_received" : "pix_sent";
    role = direction === "inflow" ? "revenue" : "expense";
    rule =
      direction === "inflow"
        ? "bank.pix_received.external_by_default"
        : "bank.pix_sent";
    if (!/\bPIX\b/.test(operation)) classificationSource = "description_assisted";
  } else if (/TARIFA|FEE|ENCARGO|MULTA/.test(clue)) {
    nature = "fee";
    role = "expense";
    rule = "bank.fee";
    classificationSource = "description_assisted";
  } else if (/JUROS/.test(clue)) {
    nature = "interest";
    role = direction === "inflow" ? "revenue" : "expense";
    rule = "bank.interest";
    classificationSource = "description_assisted";
  } else if (/TRANSFER|TED|\bDOC\b/.test(operation + " " + clue)) {
    nature = "transfer_external";
    rule = "bank.external_transfer";
  }

  const mapped = legacy(direction, nature, role);
  return {
    bank_direction: direction,
    financial_nature: nature,
    financial_role: role,
    classification_source: classificationSource,
    classification_confidence: baseConfidence,
    classification_rule: `${rule}${typeSignConflict ? ".type_sign_conflict" : ""}`,
    classification_version: BANK_CLASSIFIER_VERSION,
    ...mapped,
    suspected_transfer: false,
    review_status: reviewStatus,
  };
}
