"use client";

import { useState } from "react";
import { useClientNavigation } from "@/components/navigation/client-navigation";
import { formatScheduleCompetence, shiftScheduleCompetence } from "@/modules/flight/schedule-competence";

const labels = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function ScheduleMonthNavigator({ year, month, label }: { year: number; month: number; label: string }) {
  const navigate = useClientNavigation();
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const go = (nextYear: number, nextMonth: number) => navigate(`/escala?month=${formatScheduleCompetence({ year: nextYear, month: nextMonth })}`);
  const previous = shiftScheduleCompetence({ year, month }, -1);
  const next = shiftScheduleCompetence({ year, month }, 1);

  return <div className="relative flex items-center gap-1" aria-label="Navegação de competência">
    <button type="button" aria-label="Mês anterior" onClick={() => go(previous.year, previous.month)} className="grid size-8 place-items-center rounded-lg text-lg text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text)]">‹</button>
    <button type="button" aria-expanded={open} onClick={() => { setPickerYear(year); setOpen(value => !value); }} className="rounded-lg px-2 py-1 text-left text-2xl font-semibold tracking-tight transition hover:bg-[var(--atlas-surface)] sm:text-3xl">{label}</button>
    <button type="button" aria-label="Próximo mês" onClick={() => go(next.year, next.month)} className="grid size-8 place-items-center rounded-lg text-lg text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-surface)] hover:text-[var(--atlas-text)]">›</button>
    {open ? <div className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Ano anterior" onClick={() => setPickerYear(value => value - 1)} className="rounded-md px-2 py-1 text-[var(--atlas-muted)] hover:bg-[var(--atlas-bg)]">‹</button><b>{pickerYear}</b><button type="button" aria-label="Próximo ano" onClick={() => setPickerYear(value => value + 1)} className="rounded-md px-2 py-1 text-[var(--atlas-muted)] hover:bg-[var(--atlas-bg)]">›</button></div>
      <div className="grid grid-cols-4 gap-1">{labels.map((item, index) => <button key={item} type="button" onClick={() => { setOpen(false); go(pickerYear, index + 1); }} className={`rounded-md px-2 py-2 text-sm font-medium transition hover:bg-[var(--atlas-blue)]/15 ${pickerYear === year && index + 1 === month ? "bg-[var(--atlas-blue)]/15 text-[var(--atlas-blue)]" : "text-[var(--atlas-muted)]"}`}>{item}</button>)}</div>
    </div> : null}
  </div>;
}
