"use client";

import { useState } from "react";
import { PersonalDeductionsDialog } from "./personal-deductions-dialog";

export type PayrollLine = {
  key: string;
  amount: number;
  reference: number | null;
  metadata: unknown;
};

export type PayrollScenario = {
  estimateId: string;
  gross: number;
  lines: PayrollLine[];
  inss: number | null;
  irrf: number | null;
  personalDeductions: Array<{ name: string; amount: number }>;
  personalDeductionTotal: number | null;
  net: number | null;
  base: "PLANNED" | "EXECUTED";
};

type Scenario = "PLANNED" | "EXECUTED";

type Props = {
  label: string;
  year: number;
  month: number;
  planned: PayrollScenario | null;
  executed: PayrollScenario | null;
  defaultScenario: Scenario;
};

const payrollLabels: Record<string, string> = { SALARY: "Salário", ORGANIC_COMPENSATION: "Compensação orgânica", FIXED_HAZARD_SALARY: "Adic. periculosidade", FIXED_HAZARD_ORGANIC: "Adic. per. s/ comp. org.", SENIORITY: "Gratificação senioridade", PAYROLL_NORMAL: "Horas de voo", PAYROLL_NIGHT_NORMAL: "Noturna normal", PAYROLL_SUNDAY_HOLIDAY_DAY: "Dom/fer diurno", PAYROLL_SUNDAY_HOLIDAY_NIGHT: "Dom/fer noturno", DSR_AERONAUTAS: "DSR aeronautas", VARIABLE_HAZARD: "Adic. periculosidade aeronautas", FAM_REIMBURSEMENT: "Reembolso FAM" };
const payrollDescriptions: Record<string, string> = { SALARY: "30 dias", ORGANIC_COMPENSATION: "20% do salário", FIXED_HAZARD_SALARY: "30% do salário", FIXED_HAZARD_ORGANIC: "30% da comp. org.", SENIORITY: "7% × piso", FAM_REIMBURSEMENT: "Reembolso previsto" };
const fixedKeys = ["SALARY", "ORGANIC_COMPENSATION", "FIXED_HAZARD_SALARY", "FIXED_HAZARD_ORGANIC", "SENIORITY"];
const variableKeys = ["PAYROLL_NORMAL", "PAYROLL_NIGHT_NORMAL", "PAYROLL_SUNDAY_HOLIDAY_DAY", "PAYROLL_SUNDAY_HOLIDAY_NIGHT", "DSR_AERONAUTAS", "VARIABLE_HAZARD", "FAM_REIMBURSEMENT"];

const money = (value: number | null) => value === null ? "Pendente" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);

function periodLabel(label: string) {
  const names = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  const monthName = label.toLocaleLowerCase("pt-BR").split(" de ")[0];
  const monthIndex = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"].indexOf(monthName);
  return monthIndex >= 0 ? `${names[monthIndex]}/${label.match(/\d{4}/)?.[0] ?? ""}` : label.toUpperCase();
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

export function PayrollViewSwitcher({ label, year, month, planned, executed, defaultScenario }: Props) {
  const initialScenario = defaultScenario === "EXECUTED" && executed || !planned && executed ? "EXECUTED" : "PLANNED";
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const payroll = scenario === "PLANNED" ? planned : executed;
  const availableBoth = planned !== null && executed !== null;
  const displayLines = (payroll?.lines ?? []).filter(line => payrollLabels[line.key] !== undefined);
  const fixedLines = fixedKeys.flatMap(key => displayLines.filter(line => line.key === key));
  const variableLines = variableKeys.flatMap(key => displayLines.filter(line => line.key === key));
  const totalDiscounts = (payroll?.inss ?? 0) + (payroll?.irrf ?? 0) + (payroll?.personalDeductionTotal ?? 0);
  const hasLines = fixedLines.length + variableLines.length > 0;
  const toggle = () => setScenario(current => current === "PLANNED" ? "EXECUTED" : "PLANNED");

  return <section className="overflow-hidden rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-4 shadow-sm sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--atlas-border)]/70 pb-2.5">
      <div className="flex items-baseline gap-2"><h2 className="text-base font-semibold sm:text-lg">Holerite previsto</h2><span className="text-sm text-[var(--atlas-muted)]">· {periodLabel(label)}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm" aria-label="Escala usada no holerite">
          <span className={scenario === "PLANNED" ? "font-medium text-amber-400" : "text-[var(--atlas-muted)]"}>Planejada</span>
          <button type="button" role="switch" aria-checked={scenario === "EXECUTED"} aria-label="Alternar entre holerite da escala planejada e executada" disabled={!availableBoth} onClick={toggle} className="relative h-6 w-11 rounded-full border border-[var(--atlas-border)] bg-[var(--atlas-deep)] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45">
            <span aria-hidden="true" className={`absolute left-0.5 top-0.5 size-4.5 rounded-full bg-[var(--atlas-text)] shadow-sm transition-transform ${scenario === "EXECUTED" ? "translate-x-[22px]" : "translate-x-0"}`} />
          </button>
          <span className={scenario === "EXECUTED" ? "font-medium text-amber-400" : "text-[var(--atlas-muted)]"}>Executada</span>
        </div>
        <PersonalDeductionsDialog year={year} month={month}/>
      </div>
    </header>
    <div aria-live="polite" aria-atomic="true">
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
        <p className="mt-1.5 text-sm text-[var(--atlas-muted)]">Previsão da escala {scenario === "PLANNED" ? "planejada" : "executada"} · sujeita a ajustes de fechamento.</p>
      </div> : <p className="py-5 text-sm text-[var(--atlas-muted)]">Holerite pendente para a escala {scenario === "PLANNED" ? "planejada" : "executada"}.</p>}
    </div>
  </section>;
}
