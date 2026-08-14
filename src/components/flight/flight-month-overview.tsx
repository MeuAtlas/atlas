import Link from "next/link";
import type { FlightScheduleImport } from "@/modules/flight/types";
import { FlightMonthCalendar, type CalendarDay, type CalendarDuty, type CalendarLeg, type CalendarOvernight } from "./flight-month-calendar";
import { ReprocessScheduleButton, UpdateScheduleDialog } from "./schedule-import-dialog";
import { ScheduleMonthNavigator } from "./schedule-month-navigator";
import { PayrollViewSwitcher, type PayrollScenario } from "./payroll-view-switcher";

type ActivityData = { counts: Record<string, number>; days: CalendarDay[] };
type RuleSummary = { pass: number; fail: number; unknown: number; notApplicable: number };
type PayrollComparison = { planned: { gross: number | null; net: number | null }; executed: { gross: number | null; net: number | null }; selectedScenario: "PLANNED" | "EXECUTED" | "TIE" | "UNAVAILABLE" };
type Props = { label: string; year: number; month: number; planned: FlightScheduleImport | null; current: FlightScheduleImport | null; processingIssues: FlightScheduleImport[]; activity: ActivityData | undefined; legs: CalendarLeg[]; duties: CalendarDuty[]; overnights: CalendarOvernight[]; audit: RuleSummary; payrollScenarios: { planned: PayrollScenario | null; executed: PayrollScenario | null; defaultScenario: "PLANNED" | "EXECUTED" }; payrollComparison: PayrollComparison; cycles: Array<{ paymentDate: string; currency: string | null; amount: number; status: string }>; diems: Array<{ date: string; label: string; currency: string | null; amount: number | null }> };

const money = (value: number | null, currency = "BRL") => value === null ? "Pendente" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const duration = (minutes: number | null | undefined) => minutes === null || minutes === undefined ? "—" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>;
}

function ScheduleComparison({ planned, current, comparison, year, month }: { planned: FlightScheduleImport | null; current: FlightScheduleImport | null; comparison: PayrollComparison; year: number; month: number }) {
  const metric = (label: string, value: string | number, monetary = false) => <div className={`min-w-0 px-3 first:pl-0 last:pr-0 ${monetary ? "col-span-3 sm:col-span-1" : "col-span-2 sm:col-span-1"}`}><p className="text-sm text-[var(--atlas-muted)]">{label}</p><p className={`mt-1 text-xl font-semibold tracking-tight tabular-nums ${monetary ? "whitespace-nowrap" : "truncate"}`}>{value}</p></div>;
  const block = (title: string, item: FlightScheduleImport | null, selected: boolean, role: "PLANNED" | "EXECUTION_SNAPSHOT") => {
    const scenario = role === "PLANNED" ? comparison.planned : comparison.executed;
    return <section className="min-w-0 md:px-8 md:first:pl-0 md:last:pr-0"><div className="flex min-h-9 items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>{selected ? <span className="rounded-full border border-[var(--atlas-blue)]/45 px-2.5 py-0.5 text-sm font-medium text-[var(--atlas-blue)]">Base da folha</span> : null}</div>{role === "EXECUTION_SNAPSHOT" ? <UpdateScheduleDialog year={year} month={month} hasPlanned={planned !== null} hasExecuted={current !== null} compact /> : null}</div><p className="mt-0.5 text-sm text-[var(--atlas-muted)]">{item ? role === "PLANNED" ? "Baseline do mês" : `Última atualização: ${new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(item.uploaded_at)).replace(",", " às")}` : "Ainda não enviada"}</p><div className="mt-3.5 grid grid-cols-6 divide-x divide-[var(--atlas-border)]/70 sm:grid-cols-[.72fr_.82fr_.72fr_1.35fr_1.45fr]">{metric("FT", duration(item?.official_month_flight_time_minutes))}{metric("DT", duration(item?.official_month_duty_time_minutes))}{metric("Folgas", item?.official_off_days ?? "—")}{metric("Bruto", money(scenario.gross), true)}{metric("Líquido", money(scenario.net), true)}</div></section>;
  };
  return <Card className="p-0 shadow-none"><div className="grid gap-4 px-5 py-4 sm:px-8 md:grid-cols-2 md:divide-x md:divide-[var(--atlas-border)]/70">{block("Escala planejada", planned, comparison.selectedScenario === "PLANNED", "PLANNED")}{block("Escala executada", current, comparison.selectedScenario === "EXECUTED", "EXECUTION_SNAPSHOT")}</div></Card>;
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="px-3 first:pl-0 last:pr-0"><p className="text-sm text-[var(--atlas-muted)]">{label}</p><p className="mt-1 text-xl font-medium tracking-tight sm:text-2xl">{value}</p></div>;
}

function ProcessingWarnings({ issues }: { issues: FlightScheduleImport[] }) {
  const hours = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${Math.floor(value / 60)}h${String(value % 60).padStart(2, "0")}`;
  if (!issues.length) return null;
  return <div className="grid gap-2">{issues.map(issue => <div key={issue.id} role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/25 bg-amber-400/8 px-4 py-2.5 text-sm"><span><b>{issue.schedule_role === "PLANNED" ? "Escala planejada" : "Escala executada"}: processamento incompleto.</b> Processadas {hours(issue.processed_flight_time_minutes)} de {hours(issue.documented_flight_time_minutes)}. {typeof issue.flight_time_difference_minutes === "number" && issue.flight_time_difference_minutes > 0 ? <>Divergência de +{hours(issue.flight_time_difference_minutes)}.</> : <>Faltam {hours(issue.missing_flight_time_minutes)}.</>}</span><ReprocessScheduleButton importId={issue.id} label="Reprocessar escala" /></div>)}</div>;
}

function DiemStatement({ label, cycles, diems, unavailable = false }: { label: string; cycles: Props["cycles"]; diems: Props["diems"]; unavailable?: boolean }) {
  if (unavailable) return <Card><h2 className="text-base font-semibold sm:text-lg">Demonstrativo de diárias</h2><p className="mt-3 text-sm text-[var(--atlas-muted)]">Dados temporariamente indisponíveis. A escala precisa ser reprocessada.</p></Card>;
  const period = label.replace("agosto de", "AGO/").replace("setembro de", "SET/").replace("outubro de", "OUT/").replace("novembro de", "NOV/").replace("dezembro de", "DEZ/").replace("janeiro de", "JAN/").replace("fevereiro de", "FEV/").replace("março de", "MAR/").replace("abril de", "ABR/").replace("maio de", "MAI/").replace("junho de", "JUN/").replace("julho de", "JUL/").toUpperCase();
  const byDate = new Map(diems.map(item => [item.date, diems.filter(candidate => candidate.date === item.date)]));
  const international = diems.filter(item => item.currency !== "BRL");
  const totals = ["Café", "Almoço", "Jantar", "Ceia"].map(labelItem => ({ label: labelItem, count: diems.filter(item => item.label === labelItem).length }));
  const abbreviations: Record<string, string> = { Café: "CA", Almoço: "A", Jantar: "J", Ceia: "CE" };
  const days = Array.from({ length: 31 }, (_, index) => String(index + 1).padStart(2, "0"));
  const monthIndex = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"].findIndex(month => label.toLocaleLowerCase("pt-BR").startsWith(month));
  const year = label.match(/\d{4}/)?.[0] ?? "0000";
  const dateKey = (day: string) => `${year}-${String(monthIndex + 1).padStart(2, "0")}-${day}`;
  const totalByCurrency = ["BRL", ...Array.from(new Set(international.map(item => item.currency).filter((currency): currency is string => currency !== null)))].map(currency => ({ currency, amount: diems.filter(item => item.currency === currency).reduce((sum, item) => sum + (item.amount ?? 0), 0) })).filter(item => item.amount > 0);
  const dayRows = (range: string[]) => <div className="grid content-start gap-0.5">{range.map(day => { const entries = byDate.get(dateKey(day)) ?? []; return <div key={day} className="grid grid-cols-[28px_minmax(0,1fr)] text-sm"><span className="text-[var(--atlas-muted)]">{day}</span><span>{entries.length ? entries.map((item, index) => <span key={`${item.label}-${index}`} className={item.currency === "BRL" ? "mr-2 text-[var(--atlas-blue)]" : "mr-2 text-amber-400"}>{abbreviations[item.label]}</span>) : <span className="text-[var(--atlas-muted)]">—</span>}</span></div>; })}</div>;
  return <Card><header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold sm:text-lg">Demonstrativo de diárias <span className="text-[var(--atlas-muted)]">· {period}</span></h2></div><span className="text-sm font-semibold tabular-nums">{totalByCurrency.length ? totalByCurrency.map(item => money(item.amount, item.currency)).join(" + ") : "Pendente"}</span></header><div className="mt-3 grid divide-y divide-[var(--atlas-border)] rounded-lg border border-[var(--atlas-border)] text-sm sm:grid-cols-3 sm:divide-x sm:divide-y-0">{cycles.map(cycle => <div key={`${cycle.paymentDate}-${cycle.currency}`} className="px-3 py-2"><span className="text-[var(--atlas-muted)]">{cycle.paymentDate} · </span><span>{cycle.currency === "BRL" ? "Pagamento" : "Internacional"}</span><span className="block font-medium tabular-nums">{money(cycle.amount, cycle.currency ?? "BRL")}</span></div>)}</div><div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-1 border-y border-[var(--atlas-border)]/70 py-2 text-sm">{totals.map(item => <span key={item.label} className="text-[var(--atlas-blue)]"><b>{abbreviations[item.label]}</b> <span className="text-[var(--atlas-text)]">{item.count}</span></span>)}</div><div className="mt-3 grid grid-cols-2 gap-6 border-b border-[var(--atlas-border)]/70 pb-3">{dayRows(days.slice(0, 16))}{dayRows(days.slice(16))}</div><p className="mt-3 text-center text-sm text-[var(--atlas-muted)]">CA = Café · A = Almoço · J = Jantar · CE = Ceia</p><p className="mt-1 text-center text-sm text-[var(--atlas-muted)]"><span className="text-[var(--atlas-blue)]">Azul = nacional</span> · <span className="text-amber-400">Amarelo = internacional</span></p></Card>;
}

export function FlightMonthOverview({ label, year, month, planned, current, processingIssues, activity, legs, duties, overnights, audit, payrollScenarios, payrollComparison, cycles, diems }: Props) {
  const executedLabel = current?.snapshot_number ? `Snapshot ${current.snapshot_number} atual` : "Execução pendente";
  const executionIssue = processingIssues.find(issue => issue.schedule_role === "EXECUTION_SNAPSHOT") ?? null;
  const derivedUnavailable = Boolean(executionIssue && (!current || current.id === executionIssue.id));

  return <div className="grid gap-3 sm:gap-4">
    <header><ScheduleMonthNavigator year={year} month={month} label={label} /><p className="mt-1 text-sm text-[var(--atlas-muted)]">{executedLabel} · Base {current?.home_base ?? planned?.home_base ?? "Pendente"}</p></header>
    <ScheduleComparison planned={planned} current={current} comparison={payrollComparison} year={year} month={month} />
    <ProcessingWarnings issues={processingIssues} />
    <div className="grid gap-3 xl:grid-cols-2"><PayrollViewSwitcher label={label} year={year} month={month} planned={derivedUnavailable ? null : payrollScenarios.planned} executed={derivedUnavailable ? null : payrollScenarios.executed} defaultScenario={payrollScenarios.defaultScenario} /><DiemStatement label={label} cycles={cycles} diems={diems} unavailable={derivedUnavailable} /></div>
    {derivedUnavailable ? <p className="text-sm text-amber-400">Agenda parcial — processamento incompleto.</p> : null}
    <FlightMonthCalendar days={activity?.days ?? []} legs={legs} duties={duties} overnights={overnights} />
    {derivedUnavailable ? <p className="text-sm text-amber-400">Auditoria não conclusiva enquanto a base documental estiver incompleta.</p> : null}
    <Card><h2 className="text-base font-semibold sm:text-lg">Auditoria da escala</h2><div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3"><p className={`text-sm ${audit.fail ? "text-amber-400" : "text-emerald-400"}`}>{audit.fail ? `${audit.fail} violação(ões) confirmada(s)` : "Nenhuma violação confirmada"}</p><Metric label="Atendidas" value={audit.pass} /><Metric label="Não avaliáveis" value={audit.unknown} /><Metric label="Informativas" value={audit.notApplicable} /><Link href="/escala/regras" prefetch={false} className="text-sm font-medium text-[var(--atlas-blue)]">Ver detalhes →</Link></div></Card>
  </div>;
}
