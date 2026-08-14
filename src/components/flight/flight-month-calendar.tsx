"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarDay, CalendarEvent } from "./flight-month-calendar-types";

export type CalendarLeg = { id: string; dutyId?: string | null; sequence?: number; flightNumber?: string; aircraft?: string | null; scheduleDate: string; legType: string; origin: string | null; destination: string | null; departure: string | null; arrival: string | null; arrivalDate: string | null };
export type CalendarDuty = { id: string; sequence: number; startDate: string; endDate: string | null; checkInAirport: string | null; checkOutAirport: string | null; checkIn: string | null; checkOut: string | null; durationMinutes: number | null };
export type CalendarOvernight = { id: string; date: string; location: string | null };
export type { CalendarDay, CalendarEvent } from "./flight-month-calendar-types";

type Kind = "FLIGHT" | "DEADHEAD" | "STANDBY" | "RESERVE" | "TRAINING" | "EVALUATION" | "OFF" | "OVERNIGHT";
export type AgendaItem = { key: string; date: string; start: string | null; end: string | null; title: string; type: Kind; duty: CalendarDuty | null; legs: CalendarLeg[]; detail: string | null };
const labels: Record<Kind, string> = { FLIGHT: "Voo", DEADHEAD: "DH", STANDBY: "Sobreaviso", RESERVE: "Reserva", TRAINING: "Treinamento", EVALUATION: "Avaliação", OFF: "Folga", OVERNIGHT: "Pernoite" };
const tones: Record<Kind, string> = { FLIGHT: "text-blue-400", DEADHEAD: "text-cyan-400", STANDBY: "text-amber-400", RESERVE: "text-violet-400", TRAINING: "text-violet-400", EVALUATION: "text-violet-400", OFF: "text-emerald-400", OVERNIGHT: "text-violet-400" };
const trainingLabels: Record<string, string> = { "C-NR06-ON": "NR-06", "C-EMG-ON": "Emergências online", "C-ENS-EMG": "Emergências presenciais", "XQ-ROTA": "Avaliação em rota" };
const compactTime = (value: string | null) => value?.slice(0, 5) ?? null;
const formatDate = (date: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short" }).format(new Date(`${date}T12:00:00`)).replace(".", "").toUpperCase();
const duration = (minutes: number | null) => minutes === null ? "—" : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;

function eventItem(day: CalendarDay, event: CalendarEvent): AgendaItem | null {
  if (["CHECK_IN", "CHECK_OUT", "DEFERRED", "DEADHEAD"].includes(event.type) || event.code === "DISP-DH" || event.code.includes("DH/G3")) return null;
  if (event.type === "OFF") return { key: `event-${day.date}-${event.type}-${event.code}`, date: day.date, start: null, end: null, title: "Folga", type: "OFF", duty: null, legs: [], detail: null };
  if (event.type === "STANDBY" || event.type === "RESERVE") return { key: `event-${day.date}-${event.type}-${event.code}`, date: day.date, start: compactTime(event.start), end: compactTime(event.end), title: event.type === "STANDBY" ? "Sobreaviso" : "Reserva", type: event.type, duty: null, legs: [], detail: event.location };
  if (["COURSE", "TRAINING", "EVALUATION"].includes(event.type)) return { key: `event-${day.date}-${event.type}-${event.code}-${event.start ?? ""}`, date: day.date, start: compactTime(event.start), end: compactTime(event.end), title: trainingLabels[event.code] ?? (event.type === "EVALUATION" ? "Avaliação" : event.label ?? "Treinamento"), type: event.type === "EVALUATION" ? "EVALUATION" : "TRAINING", duty: null, legs: [], detail: event.location };
  return null;
}

export function buildFlightAgenda(days: CalendarDay[], legs: CalendarLeg[], overnights: CalendarOvernight[], duties: CalendarDuty[] = []): AgendaItem[] {
  const events = days.flatMap(day => day.events.map(event => eventItem(day, event)).filter((item): item is AgendaItem => item !== null));
  const dutyItems = duties.map(duty => {
    const dutyLegs = legs.filter(leg => leg.dutyId === duty.id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const route = dutyLegs.length ? [dutyLegs[0].origin ?? "?", ...dutyLegs.map(leg => leg.destination ?? "?")].join(" → ") : "Jornada documentada";
    const hasOperating = dutyLegs.some(leg => leg.legType === "OPERATING");
    return { key: `duty-${duty.id}`, date: duty.startDate, start: duty.checkIn, end: duty.checkOut, title: route, type: hasOperating ? "FLIGHT" as const : "DEADHEAD" as const, duty, legs: dutyLegs, detail: dutyLegs.some(leg => leg.legType === "DEADHEAD") ? "DH incluído" : null };
  });
  const unlinkedLegs = legs.filter(leg => leg.dutyId == null).map(leg => ({ key: `leg-${leg.id}`, date: leg.scheduleDate, start: compactTime(leg.departure), end: compactTime(leg.arrival), title: `${leg.origin ?? "?"} → ${leg.destination ?? "?"}`, type: leg.legType === "DEADHEAD" ? "DEADHEAD" as const : "FLIGHT" as const, duty: null, legs: [leg], detail: "Sem jornada documental" }));
  const nights = overnights.map(overnight => ({ key: `overnight-${overnight.id}`, date: overnight.date, start: null, end: null, title: `Pernoite em ${overnight.location ?? "local pendente"}`, type: "OVERNIGHT" as const, duty: null, legs: [], detail: null }));
  return [...events, ...dutyItems, ...unlinkedLegs, ...nights].sort((left, right) => `${left.date}${left.start ?? "99:99"}${left.key}`.localeCompare(`${right.date}${right.start ?? "99:99"}${right.key}`));
}

function DutyDialog({ item, onClose }: { item: AgendaItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  const crossDay = item.duty?.endDate !== null && item.duty?.endDate !== item.duty?.startDate;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="duty-dialog-title" className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] p-5 shadow-2xl">
      <header className="flex items-start justify-between gap-4"><div><h2 id="duty-dialog-title" className="text-lg font-semibold">Detalhes da jornada</h2><p className="mt-1 text-sm text-[var(--atlas-muted)]">{formatDate(item.date)}{crossDay && item.duty?.endDate ? ` → ${formatDate(item.duty.endDate)}` : ""}</p></div><button ref={closeRef} type="button" onClick={onClose} className="rounded-md border border-[var(--atlas-border)] px-3 py-1.5 text-sm" aria-label="Fechar detalhes">Fechar</button></header>
      <div className="mt-5 grid gap-3 rounded-xl border border-[var(--atlas-border)]/70 p-3 text-sm sm:grid-cols-3"><p><span className="block text-[var(--atlas-muted)]">C/I</span>{item.duty?.checkIn ?? item.start ?? "—"} · {item.duty?.checkInAirport ?? item.detail ?? "—"}</p><p><span className="block text-[var(--atlas-muted)]">C/O</span>{item.duty?.checkOut ?? item.end ?? "—"} · {item.duty?.checkOutAirport ?? "—"}</p><p><span className="block text-[var(--atlas-muted)]">Duração</span>{duration(item.duty?.durationMinutes ?? null)}{crossDay ? " · cruza meia-noite" : ""}</p></div>
      {item.legs.length ? <section className="mt-5"><h3 className="text-sm font-semibold">Pernas</h3><div className="mt-2 divide-y divide-[var(--atlas-border)]/70">{item.legs.map(leg => <div key={leg.id} className="grid gap-1 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto]"><span>{leg.origin ?? "?"} → {leg.destination ?? "?"}<span className="ml-2 text-[var(--atlas-muted)]">G3 {leg.flightNumber ?? "—"}</span></span><span className="text-[var(--atlas-muted)]">{leg.departure ?? "—"} → {leg.arrival ?? "—"}{leg.arrivalDate !== leg.scheduleDate ? " (+1)" : ""}</span><span className={leg.legType === "DEADHEAD" ? "text-cyan-400" : "text-blue-400"}>{leg.legType === "DEADHEAD" ? "DH" : "Operating"}</span></div>)}</div></section> : <section className="mt-5"><h3 className="text-sm font-semibold">Atividade</h3><p className="mt-2 text-sm text-[var(--atlas-muted)]">{item.title}{item.start && item.end ? ` · ${item.start} → ${item.end}` : ""}</p></section>}
    </section>
  </div>;
}

export function FlightMonthCalendar({ days, legs, duties, overnights }: { days: CalendarDay[]; legs: CalendarLeg[]; duties: CalendarDuty[]; overnights: CalendarOvernight[] }) {
  const [selected, setSelected] = useState<AgendaItem | null>(null);
  const items = buildFlightAgenda(days, legs, overnights, duties);
  return <section aria-label="Agenda operacional" className="min-w-0 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-4 shadow-sm sm:p-5"><h2 className="text-base font-semibold sm:text-lg">Agenda operacional</h2><div className="mt-3 overflow-x-auto"><div className="min-w-[620px]"><div className="grid grid-cols-[110px_minmax(0,1fr)_150px_100px_76px] gap-3 border-b border-[var(--atlas-border)] pb-2 text-sm font-medium text-[var(--atlas-muted)]"><span>Data</span><span>Atividade / rota</span><span>C/I → C/O</span><span>Tipo</span><span /></div>{items.length ? items.map(item => <div key={item.key} className="grid grid-cols-[110px_minmax(0,1fr)_150px_100px_76px] items-center gap-3 border-b border-[var(--atlas-border)]/55 py-1.5 text-sm"><span className="text-[var(--atlas-muted)]">{formatDate(item.date)}</span><span className="min-w-0 truncate font-medium">{item.title}{item.detail ? <span className="ml-2 text-[var(--atlas-muted)]">· {item.detail}</span> : null}</span><span className="text-[var(--atlas-muted)]">{item.start && item.end ? `${item.start} → ${item.end}${item.duty?.endDate !== item.duty?.startDate ? " (+1)" : ""}` : "—"}</span><span className={tones[item.type]}>{labels[item.type]}</span><button type="button" onClick={() => setSelected(item)} className="text-right text-[var(--atlas-blue)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--atlas-blue)]">Detalhes</button></div>) : <p className="py-6 text-sm text-[var(--atlas-muted)]">Nenhuma atividade documentada neste período.</p>}</div></div>{selected ? <DutyDialog item={selected} onClose={() => setSelected(null)} /> : null}</section>;
}
