export type EvaluationStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type EvaluationContext = "NORMAL" | "TRIGGER" | "EXCEPTION";
export type EvaluationBehavior = "BASE_LIMIT" | "QUALIFIER" | "TRIGGER" | "EXCEPTION" | "DOCUMENTARY_ONLY";
export type ComplianceBucket = "COMPLIANT" | "NON_COMPLIANT" | "NOT_EVALUABLE" | "NOT_APPLICABLE" | "INFORMATIONAL";

export type EvaluationSemantics = {
  behaviorType: EvaluationBehavior;
  complianceBucket: ComplianceBucket;
  missingFacts: string[];
};

const documentaryOnlyRules = new Set([
  "RULESET_RESIDUAL_COVERAGE_DIAGNOSTIC",
]);

const qualifierRules = new Set([
  "LAW_DEADHEAD_WORK_TIME_CLASSIFICATION",
  "LAW_GROUND_TRAINING_WORK_TIME_CLASSIFICATION",
  "LAW_SIMULATOR_WORK_TIME_CLASSIFICATION",
  "GOL_GROUND_TRAINING_NEXT_ACTIVITY_CLASSIFICATION",
  "GOL_NIGHT_OPERATION_CLASSIFICATION",
  "GOL_EARLY_START_CLASSIFICATION",
  "GOL_CONTRACTUAL_BASE_CLASSIFICATION",
]);

export function behaviorTypeForEvaluation(ruleKey: string, evaluationContext: EvaluationContext): EvaluationBehavior {
  if (evaluationContext === "EXCEPTION") return "EXCEPTION";
  if (evaluationContext === "TRIGGER") return "TRIGGER";
  if (documentaryOnlyRules.has(ruleKey)) return "DOCUMENTARY_ONLY";
  if (qualifierRules.has(ruleKey) || ruleKey.endsWith("_CLASSIFICATION")) return "QUALIFIER";
  return "BASE_LIMIT";
}

export function missingFactsFromReason(reason: unknown): string[] {
  if (typeof reason !== "string") return [];
  if (reason.includes("OPERATOR_RBAC117_REGIME_UNKNOWN")) return ["operator.rbac117_regime"];
  if (reason.includes("Base contratual documental ou de perfil indisponível")) return ["document_contractual_base", "profile_contractual_base"];
  if (reason.includes("Status de base virtual indisponível")) return ["virtual_base_active"];
  if (reason.includes("disponibilidade de transporte indisponível")) return ["transport_available_at"];
  if (reason.includes("Crew Rest Couch indisponível")) return ["inflight_rest_accommodation"];
  if (reason.includes("Timestamp de publicação documental confiável indisponível")) return ["document_generated_at"];
  return [];
}

export function deriveEvaluationSemantics(input: { ruleKey: string; status: EvaluationStatus; evaluationContext: EvaluationContext; reason?: unknown }): EvaluationSemantics {
  const behaviorType = behaviorTypeForEvaluation(input.ruleKey, input.evaluationContext);
  const complianceBucket: ComplianceBucket = input.status === "UNKNOWN"
    ? "NOT_EVALUABLE"
    : input.status === "NOT_APPLICABLE"
      ? "NOT_APPLICABLE"
      : behaviorType === "BASE_LIMIT"
        ? input.status === "PASS" ? "COMPLIANT" : "NON_COMPLIANT"
        : "INFORMATIONAL";
  return { behaviorType, complianceBucket, missingFacts: missingFactsFromReason(input.reason) };
}

export type ComplianceSummary = Record<"confirmedCompliant" | "confirmedViolations" | "notEvaluable" | "notApplicable" | "informational", number>;

export function summarizeCompliance(evaluations: Array<{ ruleKey: string; status: EvaluationStatus; evaluationContext: EvaluationContext; reason?: unknown }>): ComplianceSummary {
  return evaluations.reduce<ComplianceSummary>((summary, evaluation) => {
    const bucket = deriveEvaluationSemantics(evaluation).complianceBucket;
    if (bucket === "COMPLIANT") summary.confirmedCompliant += 1;
    if (bucket === "NON_COMPLIANT") summary.confirmedViolations += 1;
    if (bucket === "NOT_EVALUABLE") summary.notEvaluable += 1;
    if (bucket === "NOT_APPLICABLE") summary.notApplicable += 1;
    if (bucket === "INFORMATIONAL") summary.informational += 1;
    return summary;
  }, { confirmedCompliant: 0, confirmedViolations: 0, notEvaluable: 0, notApplicable: 0, informational: 0 });
}
