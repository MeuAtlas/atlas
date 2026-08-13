import { AtlasText } from "@/components/ui/atlas-text";
import type { ComplianceSummary } from "@/modules/flight/evaluation-semantics";

export type RulesEngineDiagnostic = {
  importId: string;
  filename: string;
  compliance: ComplianceSummary;
  evaluations: Array<{
    ruleKey: string;
    title: string;
    status: string;
    evaluationContext: string;
    behaviorType: string;
    complianceBucket: string;
    severity: string;
    confidence: string;
    subjectType: string;
    subjectId: string;
    explanation: string;
    missingFacts: string[];
    factsSnapshot: Record<string, unknown>;
    sourceReferences: unknown;
    rulesetVersion: string;
    ruleVersion: number;
  }>;
};

export function RulesEngineDiagnostics({ items }: { items: RulesEngineDiagnostic[] }) {
  if (!items.length) return null;
  return <section className="grid gap-4 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-5 text-sm">
    <AtlasText variant="sectionTitle">Rules Engine v1</AtlasText>
    {items.map((item) => <details key={item.importId}>
      <summary className="cursor-pointer font-semibold">{item.filename} · {item.evaluations.length} avaliações</summary>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[var(--atlas-text-muted)]">
        <span>Atendidas: {item.compliance.confirmedCompliant}</span><span>Violações: {item.compliance.confirmedViolations}</span><span>Não avaliáveis: {item.compliance.notEvaluable}</span><span>Não aplicáveis: {item.compliance.notApplicable}</span><span>Informativas: {item.compliance.informational}</span>
      </div>
      <ul className="mt-3 grid gap-3">
        {item.evaluations.map((evaluation) => <li key={`${evaluation.ruleKey}-${evaluation.evaluationContext}-${evaluation.subjectType}-${evaluation.subjectId}`}>
          <b>{evaluation.title}</b> <span className="text-[var(--atlas-text-muted)]">({evaluation.ruleKey} v{evaluation.ruleVersion})</span>: {evaluation.status}
          <div className="mt-1 text-sm text-[var(--atlas-text-muted)]">Bucket: {evaluation.complianceBucket} · Comportamento: {evaluation.behaviorType} · Contexto: {evaluation.evaluationContext} · Severidade: {evaluation.severity} · Confiança: {evaluation.confidence}</div>
          <div className="mt-1 text-sm text-[var(--atlas-text-muted)]">Subject: {evaluation.subjectType} · {evaluation.subjectId} · Import: {item.importId} · Ruleset: {evaluation.rulesetVersion}</div>
          <div className="mt-1 text-sm text-[var(--atlas-text-muted)]">Limite: {String(evaluation.factsSnapshot.legalLimit ?? "UNKNOWN")} · Atual: {String(evaluation.factsSnapshot.actual ?? evaluation.factsSnapshot.dutyMinutes ?? evaluation.factsSnapshot.minutes ?? "UNKNOWN")} · Motivo: {evaluation.explanation} · Fatos ausentes: {evaluation.missingFacts.length ? evaluation.missingFacts.join(", ") : "não explicitados"} · Fonte: {JSON.stringify(evaluation.sourceReferences)}</div>
        </li>)}
      </ul>
    </details>)}
  </section>;
}
