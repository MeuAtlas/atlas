import { AtlasText } from "@/components/ui/atlas-text";

export type FinancialUnitsDiagnostic = { importId: string; filename: string; operatingSeconds: number; deadheadSeconds: number; standbyActualSeconds: number; standbyNumeratorSeconds: number; standbyDenominator: number; reserveSeconds: number; specialPendingSeconds: number };
function clock(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`; }

export function FinancialUnitsDiagnostics({ items }: { items: FinancialUnitsDiagnostic[] }) {
  if (!items.length) return null;
  return <section className="grid gap-3 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-5 text-sm"><AtlasText variant="sectionTitle">Financial Units</AtlasText>{items.map((item) => <div key={item.importId} className="grid gap-1 border-t border-[var(--atlas-border)] pt-3 first:border-t-0 first:pt-0"><b>{item.filename}</b><p>Operating: {clock(item.operatingSeconds)} · Deadhead: {clock(item.deadheadSeconds)} · Standby: {clock(item.standbyActualSeconds)}</p><p>Standby equivalente: {clock(Math.floor(item.standbyNumeratorSeconds / item.standbyDenominator))} ({item.standbyNumeratorSeconds}/{item.standbyDenominator} s) · Reserve: {clock(item.reserveSeconds)}</p><p>Tempo especial pendente de classificação: {clock(item.specialPendingSeconds)}. Sem cálculo em R$.</p></div>)}</section>;
}
