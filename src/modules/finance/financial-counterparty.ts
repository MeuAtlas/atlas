import { createHmac } from "node:crypto";

type UnknownRecord = Record<string, unknown>;

export function normalizeFinancialName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export type CounterpartyDirection = "inflow" | "outflow";

export interface CounterpartyFingerprint {
  providerCounterpartyId: string | null;
  pixKeyHash: string | null;
  taxNumberHash: string | null;
  maskedTaxNumber: string | null;
  maskedPixKey: string | null;
  bankCode: string | null;
  bankName: string | null;
  branchMasked: string | null;
  accountMasked: string | null;
  merchantIdentifier: string | null;
  normalizedCounterpartyName: string | null;
  descriptionQualifier: string;
  descriptionFingerprint: string;
  compositeFingerprint: string;
  confidence: number;
  evidence: string[];
  sourceFields: string[];
  primaryIdentifier:
    | "provider_counterparty_id"
    | "tax_number_hash"
    | "pix_key_hash"
    | "bank_account"
    | "merchant_identifier"
    | "normalized_name"
    | "description";
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function digits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function allEqual(value: string) {
  return /^(\d)\1+$/.test(value);
}

function validCnpj(value: string) {
  if (value.length !== 14 || allEqual(value)) return false;
  const calculate = (length: 12 | 13) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce(
      (total, weight, index) => total + Number(value[index]) * weight,
      0,
    );
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return calculate(12) === Number(value[12]) &&
    calculate(13) === Number(value[13]);
}

export function normalizeBrazilianTaxNumber(value: unknown) {
  const raw = digits(String(value ?? "").replace(/\b(?:CNPJ|CPF)\b/gi, ""));
  if ((raw.length === 11 || raw.length === 14) && !allEqual(raw)) {
    return raw;
  }
  if (raw.length === 15) {
    const predictableBranchDuplication = raw.match(/^(\d{8})1(0001\d{2})$/);
    if (predictableBranchDuplication) {
      return `${predictableBranchDuplication[1]}${predictableBranchDuplication[2]}`;
    }
    const candidates = Array.from({ length: raw.length }, (_, index) =>
      raw.slice(0, index) + raw.slice(index + 1),
    ).filter((candidate, index, values) =>
      validCnpj(candidate) && values.indexOf(candidate) === index,
    );
    if (candidates.length === 1) return candidates[0];
  }
  return null;
}

export function maskFinancialIdentifier(value: unknown) {
  const compact = String(value ?? "").replace(/\s+/g, "");
  if (!compact) return null;
  return compact.length <= 4
    ? "••••"
    : `${compact.slice(0, 2)}••••${compact.slice(-2)}`;
}

function hashingSecret() {
  const configured = process.env.FINANCIAL_IDENTIFIER_HASH_SECRET ||
    process.env.PLUGGY_CLIENT_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("FINANCIAL_IDENTIFIER_HASH_SECRET_NOT_CONFIGURED");
  }
  return "atlas-financial-identifier-development-v1";
}

export function hashFinancialIdentifier(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("pt-BR");
  return normalized
    ? createHmac("sha256", hashingSecret()).update(normalized).digest("hex")
    : null;
}

function firstText(
  sources: Array<[string, unknown]>,
  sourceFields: string[],
) {
  for (const [field, candidate] of sources) {
    const value = text(candidate);
    if (!value) continue;
    sourceFields.push(field);
    return value;
  }
  return null;
}

function documentFromDescription(description: string) {
  const labeled = description.match(/\b(?:CNPJ|CPF)\D*((?:\d[\s./-]*){11,15})/i);
  if (labeled) return labeled[1];
  return null;
}

export function pixCounterpartyNameFromDescription(value: unknown) {
  const description = text(value);
  if (!description) return null;
  const match = description.match(
    /^\s*PIX\s+(?:ENVIADO|RECEBIDO)(?:\s+(?:PARA|DE))?\s*[:\-]?\s+(.+?)\s*$/i,
  );
  if (!match) return null;
  const candidate = match[1]
    .replace(/\s+\b(?:CPF|CNPJ)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = normalizeFinancialName(candidate);
  const meaningfulWords = normalized
    .split(" ")
    .filter(word => word.length >= 2 && !["da", "de", "do", "dos", "das", "e"].includes(word));
  if (meaningfulWords.length < 2 || /\b(?:pix|enviado|recebido)\b/i.test(candidate)) {
    return null;
  }
  return candidate;
}

export function extractCounterpartyFingerprint(input: {
  description: string;
  merchant?: string | null;
  providerMetadata?: unknown;
  provider?: string | null;
  direction: CounterpartyDirection;
}): CounterpartyFingerprint {
  const metadata = record(input.providerMetadata);
  const counterparty = record(metadata.counterparty);
  const paymentData = record(metadata.paymentData);
  const sourceFields: string[] = [];
  const evidence: string[] = [];

  const providerCounterpartyId = firstText([
    ["counterparty.providerCounterpartyId", counterparty.providerCounterpartyId],
    ["counterparty.id", counterparty.id],
  ], sourceFields);
  const rawTaxNumber = firstText([
    ["counterparty.taxNumber", counterparty.taxNumber],
    ["counterparty.document", counterparty.document],
    ["paymentData.taxNumber", paymentData.taxNumber],
    ["description.taxNumber", documentFromDescription(input.description)],
  ], sourceFields);
  const normalizedTaxNumber = normalizeBrazilianTaxNumber(rawTaxNumber);
  const existingTaxHash = text(counterparty.taxNumberHash);
  const taxNumberHash = normalizedTaxNumber
    ? hashFinancialIdentifier(normalizedTaxNumber)
    : existingTaxHash;
  const rawPixKey = firstText([
    ["counterparty.pixKey", counterparty.pixKey],
    ["paymentData.pixKey", paymentData.pixKey],
  ], sourceFields);
  const existingPixHash = text(counterparty.pixKeyHash);
  const pixKeyHash = rawPixKey ? hashFinancialIdentifier(rawPixKey) : existingPixHash;
  const bankCode = firstText([
    ["counterparty.bankCode", counterparty.bankCode],
  ], sourceFields);
  const bankName = firstText([
    ["counterparty.bankName", counterparty.bankName],
  ], sourceFields);
  const branchMasked = firstText([
    ["counterparty.branchMasked", counterparty.branchMasked],
  ], sourceFields);
  const accountMasked = firstText([
    ["counterparty.accountMasked", counterparty.accountMasked],
  ], sourceFields);
  const merchantIdentifier = firstText([
    ["counterparty.merchantIdentifier", counterparty.merchantIdentifier],
    ["merchant.id", record(metadata.merchant).id],
  ], sourceFields);
  const pixDescriptionName = pixCounterpartyNameFromDescription(input.description);
  const displayName = firstText([
    ["counterparty.displayName", counterparty.displayName],
    ["counterparty.name", counterparty.name],
    ["merchant", input.merchant],
    ["description.pixCounterpartyName", pixDescriptionName],
  ], sourceFields);
  const normalizedCounterpartyName = normalizeFinancialName(
    displayName ?? input.description,
  ) || null;
  const normalizedDescription = normalizeFinancialName(input.description);
  const semanticDescription = normalizedDescription
    .split(/\b(?:cnpj|cpf)\b/)[0]?.trim() || normalizedDescription;
  const descriptionQualifier = semanticDescription;
  const descriptionFingerprint = hashFinancialIdentifier(
    semanticDescription,
  ) ?? "";

  let primaryIdentifier: CounterpartyFingerprint["primaryIdentifier"];
  let confidence: number;
  let stableValue: string;
  if (taxNumberHash) {
    primaryIdentifier = "tax_number_hash";
    confidence = normalizedTaxNumber ? 0.98 : 0.94;
    stableValue = `${taxNumberHash}:${descriptionFingerprint}`;
  } else if (providerCounterpartyId) {
    primaryIdentifier = "provider_counterparty_id";
    confidence = 0.99;
    stableValue = providerCounterpartyId;
  } else if (pixKeyHash) {
    primaryIdentifier = "pix_key_hash";
    confidence = 0.97;
    stableValue = pixKeyHash;
  } else if (bankCode && accountMasked) {
    primaryIdentifier = "bank_account";
    confidence = 0.95;
    stableValue = `${bankCode}:${accountMasked}`;
  } else if (merchantIdentifier) {
    primaryIdentifier = "merchant_identifier";
    confidence = 0.94;
    stableValue = merchantIdentifier;
  } else if (displayName && normalizedCounterpartyName) {
    primaryIdentifier = "normalized_name";
    confidence = sourceFields.includes("description.pixCounterpartyName")
      ? 0.9
      : 0.86;
    stableValue = normalizedCounterpartyName;
  } else {
    primaryIdentifier = "description";
    confidence = 0.7;
    stableValue = descriptionFingerprint;
  }
  evidence.push(primaryIdentifier);
  if (pixDescriptionName) evidence.push("pix_description_counterparty");
  if (normalizedTaxNumber) evidence.push("valid_brazilian_tax_number");
  if (rawTaxNumber && !normalizedTaxNumber) evidence.push("invalid_tax_number_text");

  const compositeFingerprint = hashFinancialIdentifier([
    input.provider ?? "unknown",
    primaryIdentifier,
    stableValue,
  ].join("|")) ?? descriptionFingerprint;

  return {
    providerCounterpartyId,
    pixKeyHash,
    taxNumberHash,
    maskedTaxNumber: normalizedTaxNumber
      ? maskFinancialIdentifier(normalizedTaxNumber)
      : null,
    maskedPixKey: rawPixKey ? maskFinancialIdentifier(rawPixKey) : null,
    bankCode,
    bankName,
    branchMasked,
    accountMasked,
    merchantIdentifier,
    normalizedCounterpartyName,
    descriptionQualifier,
    descriptionFingerprint,
    compositeFingerprint,
    confidence,
    evidence,
    sourceFields,
    primaryIdentifier,
  };
}

export function fingerprintsMatch(
  left: CounterpartyFingerprint,
  right: CounterpartyFingerprint,
) {
  // Strong identifiers are authoritative. A provider may repeat a generic
  // counterparty/account id across unrelated credits, so it must never override
  // a document or Pix key found in the source movement.
  if (left.taxNumberHash || right.taxNumberHash) {
    return Boolean(
      left.taxNumberHash &&
      left.taxNumberHash === right.taxNumberHash &&
      left.descriptionFingerprint &&
      left.descriptionFingerprint === right.descriptionFingerprint
    );
  }
  if (left.pixKeyHash) return left.pixKeyHash === right.pixKeyHash;
  if (left.providerCounterpartyId) {
    return left.providerCounterpartyId === right.providerCounterpartyId;
  }
  if (left.bankCode && left.accountMasked) {
    return left.bankCode === right.bankCode &&
      left.accountMasked === right.accountMasked;
  }
  if (left.merchantIdentifier) {
    return left.merchantIdentifier === right.merchantIdentifier;
  }
  if (left.compositeFingerprint === right.compositeFingerprint) return true;
  return Boolean(
    left.confidence >= 0.84 &&
    right.confidence >= 0.84 &&
    left.normalizedCounterpartyName &&
    left.normalizedCounterpartyName === right.normalizedCounterpartyName
  );
}
