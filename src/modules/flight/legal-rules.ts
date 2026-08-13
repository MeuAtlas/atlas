import { z } from "zod";

const identifier = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,119}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const legalStatuses = ["DRAFT", "REVIEWED", "ACTIVE", "SUPERSEDED", "RETIRED"] as const;
const sourceRoles = ["PRIMARY", "SUPPLEMENTARY", "OVERRIDES", "LIMITS", "REFERENCES"] as const;
const ruleCategories = ["OPERATING_LIMIT", "REST", "STANDBY", "RESERVE", "OFF_DAY", "NIGHT_OPERATION", "TRAINING", "DEADHEAD", "MEAL_ALLOWANCE", "FLIGHT_PAY", "SENIORITY", "INDEMNITY", "ADDITIONAL_PAY", "OTHER"] as const;

const objectRecord = z.record(z.string(), z.unknown());

export const ruleManifestSchema = z.object({
  instrument: z.object({
    instrumentType: z.enum(["LAW", "REGULATION", "CCT", "ACT", "ADDENDUM", "OTHER", "INTERNAL_CONFIRMED_RULE"]),
    instrumentCode: identifier,
    version: z.number().int().min(1),
    title: z.string().trim().min(1),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    status: z.enum(legalStatuses).default("DRAFT"),
    supersedes: z.object({ instrumentCode: identifier, version: z.number().int().min(1) }).nullable().optional(),
    metadata: objectRecord.default({}),
  }),
  clauses: z.array(z.object({
    clauseKey: identifier.optional(),
    clauseNumber: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).nullable().optional(),
    sourceText: z.string().trim().min(1),
    effectiveFrom: isoDate.nullable().optional(),
    effectiveTo: isoDate.nullable().optional(),
    metadata: objectRecord.default({}),
  })).default([]),
  rules: z.array(z.object({
    ruleKey: identifier,
    ruleVersion: z.number().int().min(1),
    title: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    category: z.enum(ruleCategories),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    status: z.enum(legalStatuses).default("DRAFT"),
    priority: z.number().int().default(0),
    scope: objectRecord.default({}),
    conditions: objectRecord.default({}),
    calculation: objectRecord.default({}),
    sourceConfidence: z.enum(["UNVERIFIED", "LOW", "MEDIUM", "HIGH"]).default("UNVERIFIED"),
    reviewStatus: z.enum(["DRAFT", "REVIEWED", "APPROVED", "REJECTED"]).default("DRAFT"),
    sources: z.array(z.object({
      clauseKey: identifier.optional(),
      sourceRole: z.enum(sourceRoles),
      notes: z.string().nullable().optional(),
    })).min(1),
    metadata: objectRecord.default({}),
  })).default([]),
  ruleset: z.object({
    rulesetCode: identifier,
    version: z.number().int().min(1),
    name: z.string().trim().min(1),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
    status: z.enum(legalStatuses).default("DRAFT"),
    ruleReferences: z.array(z.object({ ruleKey: identifier, ruleVersion: z.number().int().min(1), sequence: z.number().int().positive() })).min(1),
    metadata: objectRecord.default({}),
  }).nullable().optional(),
});

export type RuleManifest = z.infer<typeof ruleManifestSchema>;
export type RuleManifestExistingRule = Pick<RuleManifest["rules"][number], "ruleKey" | "ruleVersion" | "effectiveFrom" | "effectiveTo" | "status" | "scope">;
export type RuleManifestValidation = {
  valid: boolean;
  manifest: RuleManifest | null;
  newInstruments: number;
  newClauses: number;
  newRules: number;
  supersededRules: Array<{ ruleKey: string; ruleVersion: number }>;
  conflicts: string[];
  overlappingRules: string[];
  missingSources: string[];
};

function isDateRangeValid(start: string, end: string | null | undefined) {
  return !end || end >= start;
}

function rangesOverlap(firstStart: string, firstEnd: string | null | undefined, secondStart: string, secondEnd: string | null | undefined) {
  return (firstEnd ?? "9999-12-31") >= secondStart && (secondEnd ?? "9999-12-31") >= firstStart;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function scopesEqual(left: Record<string, unknown>, right: Record<string, unknown>) {
  return stableJson(left) === stableJson(right);
}

export function validateRuleManifest(input: unknown, existingRules: RuleManifestExistingRule[] = []): RuleManifestValidation {
  const parsed = ruleManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, manifest: null, newInstruments: 0, newClauses: 0, newRules: 0, supersededRules: [], conflicts: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`), overlappingRules: [], missingSources: [] };
  }
  const manifest = parsed.data;
  const conflicts: string[] = [];
  const overlappingRules: string[] = [];
  const missingSources: string[] = [];
  if (!isDateRangeValid(manifest.instrument.effectiveFrom, manifest.instrument.effectiveTo)) conflicts.push("A vigência do instrumento é inválida.");
  const clauseKeys = new Set<string>();
  for (const clause of manifest.clauses) {
    if (clause.clauseKey) {
      if (clauseKeys.has(clause.clauseKey)) conflicts.push(`clause_key duplicada: ${clause.clauseKey}.`);
      clauseKeys.add(clause.clauseKey);
    }
    if (clause.effectiveFrom && !isDateRangeValid(clause.effectiveFrom, clause.effectiveTo)) conflicts.push(`A vigência da cláusula ${clause.clauseKey ?? clause.clauseNumber ?? "sem chave"} é inválida.`);
  }
  const allRules = [...existingRules, ...manifest.rules];
  for (const rule of manifest.rules) {
    if (!isDateRangeValid(rule.effectiveFrom, rule.effectiveTo)) conflicts.push(`A vigência da regra ${rule.ruleKey} v${rule.ruleVersion} é inválida.`);
    for (const source of rule.sources) if (source.clauseKey && !clauseKeys.has(source.clauseKey)) missingSources.push(`${rule.ruleKey} v${rule.ruleVersion}: ${source.clauseKey}`);
    const duplicates = allRules.filter((candidate) => candidate.ruleKey === rule.ruleKey && candidate.ruleVersion === rule.ruleVersion);
    if (duplicates.length > 1) conflicts.push(`Versão duplicada: ${rule.ruleKey} v${rule.ruleVersion}.`);
    if (rule.status === "ACTIVE") for (const candidate of allRules) {
      if (candidate === rule || candidate.status !== "ACTIVE" || candidate.ruleKey !== rule.ruleKey || !scopesEqual(candidate.scope, rule.scope)) continue;
      if (rangesOverlap(candidate.effectiveFrom, candidate.effectiveTo, rule.effectiveFrom, rule.effectiveTo)) overlappingRules.push(`${rule.ruleKey} v${rule.ruleVersion} conflita com v${candidate.ruleVersion}.`);
    }
  }
  if (manifest.ruleset) {
    if (!isDateRangeValid(manifest.ruleset.effectiveFrom, manifest.ruleset.effectiveTo)) conflicts.push("A vigência do ruleset é inválida.");
    const sequences = new Set<number>();
    for (const reference of manifest.ruleset.ruleReferences) {
      if (sequences.has(reference.sequence)) conflicts.push(`Sequência duplicada no ruleset: ${reference.sequence}.`);
      sequences.add(reference.sequence);
      if (!manifest.rules.some((rule) => rule.ruleKey === reference.ruleKey && rule.ruleVersion === reference.ruleVersion) && !existingRules.some((rule) => rule.ruleKey === reference.ruleKey && rule.ruleVersion === reference.ruleVersion)) conflicts.push(`Ruleset referencia regra inexistente: ${reference.ruleKey} v${reference.ruleVersion}.`);
    }
  }
  const supersededRules = manifest.rules.flatMap((rule) => existingRules.filter((existing) => existing.ruleKey === rule.ruleKey && existing.ruleVersion < rule.ruleVersion).map((existing) => ({ ruleKey: existing.ruleKey, ruleVersion: existing.ruleVersion })));
  return { valid: conflicts.length === 0 && overlappingRules.length === 0 && missingSources.length === 0, manifest, newInstruments: 1, newClauses: manifest.clauses.length, newRules: manifest.rules.length, supersededRules, conflicts, overlappingRules, missingSources };
}

export async function applyRuleManifest(
  input: unknown,
  persist: (manifest: RuleManifest, validation: RuleManifestValidation) => Promise<void>,
  existingRules: RuleManifestExistingRule[] = [],
) {
  const validation = validateRuleManifest(input, existingRules);
  if (!validation.valid || !validation.manifest) return validation;
  await persist(validation.manifest, validation);
  return validation;
}
