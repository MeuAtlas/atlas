import { AtlasText } from "@/components/ui/atlas-text";

export type FinancialClosureDiagnostic = {
  year: number;
  month: number;
  knownTotalBrl: number;
  finalTotalBrl: number | null;
  status: string;
  lines: Array<{ component: string; amount: number | null; status: string; reason: string | null }>;
};

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const label = (status: string) => status === "CALCULATED" ? "Resolvido" : status === "PROVISIONAL" ? "Provisório" : status === "NOT_APPLICABLE" ? "Não aplicável" : "Pendente";

export function FinancialClosureDiagnostics({ items }: { items: FinancialClosureDiagnostic[] }) {
  if (!items.length) return null;
  return <section className="grid gap-3 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-5 text-sm"><AtlasText variant="sectionTitle">Financial Monthly Closure</AtlasText>{items.map(item => <div key={`${item.year}-${item.month}`} className="grid gap-1"><b>{String(item.month).padStart(2, "0")}/{item.year} · {item.status}</b><span>Known BRL total: {money(item.knownTotalBrl)} · final total: {item.finalTotalBrl === null ? "UNKNOWN / INCOMPLETE" : money(item.finalTotalBrl)}</span>{item.lines.map(line => <span key={line.component}>{line.component}: {line.amount === null ? "UNKNOWN" : money(line.amount)} · {label(line.status)}{line.reason ? ` · ${line.reason}` : ""}</span>)}</div>)}</section>;
}
