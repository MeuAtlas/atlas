import Link from "next/link";
import type { FlightScheduleImport } from "@/modules/flight/types";
import { FlightMonthCalendar, type CalendarDay, type CalendarDuty, type CalendarLeg, type CalendarOvernight } from "./flight-month-calendar";

type ActivityData = { counts: Record<string, number>; days: CalendarDay[] };
type RuleSummary = { pass: number; fail: number; unknown: number; notApplicable: number };
type PayrollLine = { key: string; amount: number; reference: number | null; metadata: unknown };
type Payroll = { estimateId: string; gross: number; lines: PayrollLine[]; inss: number | null; irrf: number | null; personalDeductions: Array<{ name: string; amount: number }>; personalDeductionTotal: number | null; net: number | null; base: "EXECUTED" };
type Props = { label: string; planned: FlightScheduleImport | null; current: FlightScheduleImport | null; activity: ActivityData | undefined; legs: CalendarLeg[]; duties: CalendarDuty[]; overnights: CalendarOvernight[]; audit: RuleSummary; payroll: Payroll | null; cycles: Array<{ paymentDate: string; currency: string | null; amount: number; status: string }>; diems: Array<{ date: string; label: string; currency: string | null; amount: number | null }> };

const money = (value: number | null, currency = "BRL") => value === null ? "Pendente" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100);
const duration = (minutes: number | null | undefined) => minutes === null || minutes === undefined ? "—" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const payrollLabels: Record<string, string> = { SALARY: "Salário", ORGANIC_COMPENSATION: "Compensação orgânica", FIXED_HAZARD_SALARY: "Adic. periculosidade", FIXED_HAZARD_ORGANIC: "Adic. per. s/ comp. org.", SENIORITY: "Gratificação senioridade", PAYROLL_NORMAL: "Horas de voo", PAYROLL_NIGHT_NORMAL: "Noturna normal", PAYROLL_SUNDAY_HOLIDAY_DAY: "Dom/fer diurno", PAYROLL_SUNDAY_HOLIDAY_NIGHT: "Dom/fer noturno", DSR_AERONAUTAS: "DSR aeronautas", VARIABLE_HAZARD: "Adic. periculosidade aeronautas", FAM_REIMBURSEMENT: "Reembolso FAM" };
const payrollDescriptions: Record<string, string> = { SALARY: "30 dias", ORGANIC_COMPENSATION: "20% do salário", FIXED_HAZARD_SALARY: "30% do salário", FIXED_HAZARD_ORGANIC: "30% da comp. org.", SENIORITY: "7% × piso", FAM_REIMBURSEMENT: "Reembolso previsto" };
const fixedKeys = ["SALARY", "ORGANIC_COMPENSATION", "FIXED_HAZARD_SALARY", "FIXED_HAZARD_ORGANIC", "SENIORITY"];
const variableKeys = ["PAYROLL_NORMAL", "PAYROLL_NIGHT_NORMAL", "PAYROLL_SUNDAY_HOLIDAY_DAY", "PAYROLL_SUNDAY_HOLIDAY_NIGHT", "DSR_AERONAUTAS", "VARIABLE_HAZARD", "FAM_REIMBURSEMENT"];

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>;
}

function ScheduleComparison({ planned, current, payroll }: { planned: FlightScheduleImport | null; current: FlightScheduleImport | null; payroll: Payroll | null }) {
  const block = (title: string, item: FlightScheduleImport | null, selected: boolean) => <section className="min-w-0 px-4 py-1 first:pl-0 last:pr-0"><div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-[var(--atlas-blue)]">{title}</h2>{selected ? <span className="rounded-full border border-[var(--atlas-blue)]/45 px-2 py-0.5 text-sm text-[var(--atlas-blue)]">Base da folha</span> : null}</div><div className="mt-2 grid grid-cols-3 divide-x divide-[var(--atlas-border)]"><Metric label="FT" value={duration(item?.official_month_flight_time_minutes)} /><Metric label="DT" value={duration(item?.official_month_duty_time_minutes)} /><Metric label="Folgas" value={item?.official_off_days ?? "—"} /></div></section>;
  return <Card><div className="grid gap-3 md:grid-cols-2 md:divide-x md:divide-[var(--atlas-border)]">{block("Escala planejada", planned, payroll?.base !== "EXECUTED")}{block("Escala executada", current, payroll?.base === "EXECUTED")}</div></Card>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="px-3 first:pl-0 last:pr-0"><p className="text-sm text-[var(--atlas-muted)]">{label}</p><p className="mt-1 text-xl font-medium tracking-tight sm:text-2xl">{value}</p></div>;
}

function payrollFormula(line: PayrollLine) {
  if (line.reference !== null) {
    const metadata = line.metadata;
    const rate = metadata !== null && typeof metadata === "object" && "rateCents" in metadata && typeof metadata.rateCents === "number" ? metadata.rateCents : null;
    return rate === null ? `${Number(line.reference).toFixed(2).replace(".", ",")}h de referência` : `${Number(line.reference).toFixed(2).replace(".", ",")}h × ${money(rate)}`;
  }
  return payrollDescriptions[line.key] ?? "Referência documental";
}

function PayrollRows({ lines }: { lines: PayrollLine[] }) {
  return <div className="mt-0.5">
    {lines.map(line => <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-0.5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(10rem,1.15fr)_auto] sm:items-baseline">
      <span className="min-w-0 truncate">{payrollLabels[line.key]}</span>
      <span className="hidden min-w-0 truncate text-[var(--atlas-muted)] sm:block">{payrollFormula(line)}</span>
      <span className="shrink-0 text-right font-medium tabular-nums">{money(line.amount)}</span>
      <span className="col-span-2 truncate text-sm text-[var(--atlas-muted)] sm:hidden">{payrollFormula(line)}</span>
    </div>)}
  </div>;
}

function PayrollStatement({ label, payroll, fixedLines, variableLines }: { label: string; payroll: Payroll | null; fixedLines: PayrollLine[]; variableLines: PayrollLine[] }) {
  const period = label.replace("agosto de", "AGO/").replace("setembro de", "SET/").replace("outubro de", "OUT/").replace("novembro de", "NOV/").replace("dezembro de", "DEZ/").replace("janeiro de", "JAN/").replace("fevereiro de", "FEV/").replace("março de", "MAR/").replace("abril de", "ABR/").replace("maio de", "MAI/").replace("junho de", "JUN/").replace("julho de", "JUL/").toUpperCase();
  const totalDiscounts = (payroll?.inss ?? 0) + (payroll?.irrf ?? 0) + (payroll?.personalDeductionTotal ?? 0);
  const hasLines = fixedLines.length + variableLines.length > 0;
  return <Card className="overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--atlas-border)]/70 pb-2.5">
      <div className="flex items-baseline gap-2"><h2 className="text-base font-semibold sm:text-lg">Demonstrativo previsto</h2><span className="text-sm text-[var(--atlas-muted)]">· {period}</span></div>
      <span className="rounded-md border border-[var(--atlas-border)] px-2.5 py-1 text-sm text-[var(--atlas-muted)]">Base: Executada</span>
    </header>
    {hasLines ? <div className="pt-2.5">
      <section>
        <h3 className="text-sm font-semibold text-[var(--atlas-blue)]">Proventos</h3>
        <h4 className="mt-1.5 text-sm font-medium text-[var(--atlas-muted)]">Fixo</h4>
        <PayrollRows lines={fixedLines} />
        <h4 className="mt-2 border-t border-[var(--atlas-border)]/70 pt-2 text-sm font-medium text-[var(--atlas-muted)]">Variável</h4>
        <PayrollRows lines={variableLines} />
        <div className="mt-2 flex justify-between border-t border-[var(--atlas-border)] pt-2 text-base font-semibold"><span className="text-[var(--atlas-blue)]">Total de proventos</span><span className="tabular-nums text-[var(--atlas-blue)]">{money(payroll?.gross ?? null)}</span></div>
      </section>
      <section className="mt-2.5 border-t border-[var(--atlas-border)] pt-2.5">
        <h3 className="text-sm font-semibold text-red-400">Descontos</h3>
        <div className="mt-1 text-sm">
          <div className="flex justify-between py-0.5"><span>INSS</span><span className="font-medium tabular-nums">{money(payroll?.inss ?? null)}</span></div>
          <div className="flex justify-between py-0.5"><span>IRRF</span><span className="font-medium tabular-nums">{money(payroll?.irrf ?? null)}</span></div>
          {payroll?.personalDeductions.map(item => <div key={item.name} className="flex justify-between py-0.5"><span>{item.name}</span><span className="font-medium tabular-nums">{money(item.amount)}</span></div>)}
          {!payroll?.personalDeductions.length ? <div className="flex justify-between py-0.5"><span>Descontos pessoais</span><span className="font-medium tabular-nums">{money(payroll?.personalDeductionTotal ?? null)}</span></div> : null}
        </div>
        <div className="mt-2 flex justify-between border-t border-[var(--atlas-border)] pt-2 text-base font-semibold text-red-400"><span>Total de descontos</span><span className="tabular-nums">−{money(totalDiscounts)}</span></div>
      </section>
      <div className="mt-2.5 flex items-center justify-between rounded-lg border border-[var(--atlas-blue)]/25 bg-[var(--atlas-blue)]/10 px-3 py-2 text-base font-semibold sm:text-lg"><span className="text-[var(--atlas-blue)]">Líquido previsto</span><span className="tabular-nums text-[var(--atlas-blue)]">{money(payroll?.net ?? null)}</span></div>
      <p className="mt-1.5 text-sm text-[var(--atlas-muted)]">Previsão baseada no snapshot atual · sujeita a ajustes de fechamento.</p>
    </div> : <p className="py-5 text-sm text-[var(--atlas-muted)]">Demonstrativo pendente.</p>}
  </Card>;
}

function DiemStatement({ label, cycles, diems }: { label: string; cycles: Props["cycles"]; diems: Props["diems"] }) {
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

export function FlightMonthOverview({ label, planned, current, activity, legs, duties, overnights, audit, payroll, cycles, diems }: Props) {
  const displayLines = (payroll?.lines ?? []).filter(line => payrollLabels[line.key] !== undefined);
  const fixedLines = fixedKeys.flatMap(key => displayLines.filter(line => line.key === key));
  const variableLines = variableKeys.flatMap(key => displayLines.filter(line => line.key === key));
  const executedLabel = current?.snapshot_number ? `Snapshot ${current.snapshot_number} atual` : "Execução pendente";

  return <div className="grid gap-3 sm:gap-4">
    <header><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{label}</h1><p className="mt-1 text-sm text-[var(--atlas-muted)]">{executedLabel} · Base {current?.home_base ?? planned?.home_base ?? "Pendente"}</p></header>
    <ScheduleComparison planned={planned} current={current} payroll={payroll} />
    <div className="grid gap-3 xl:grid-cols-2"><PayrollStatement label={label} payroll={payroll} fixedLines={fixedLines} variableLines={variableLines} /><DiemStatement label={label} cycles={cycles} diems={diems} /></div>
    <FlightMonthCalendar days={activity?.days ?? []} legs={legs} duties={duties} overnights={overnights} />
    <Card><h2 className="text-base font-semibold sm:text-lg">Auditoria da escala</h2><div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3"><p className={`text-sm ${audit.fail ? "text-amber-400" : "text-emerald-400"}`}>{audit.fail ? `${audit.fail} violação(ões) confirmada(s)` : "Nenhuma violação confirmada"}</p><Metric label="Atendidas" value={audit.pass} /><Metric label="Não avaliáveis" value={audit.unknown} /><Metric label="Informativas" value={audit.notApplicable} /><Link href="/escala/regras" prefetch={false} className="text-sm font-medium text-[var(--atlas-blue)]">Ver detalhes →</Link></div></Card>
  </div>;
}
