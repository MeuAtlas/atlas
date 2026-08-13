import Link from "next/link";
import { AtlasText } from "@/components/ui/atlas-text";
import { DeleteScheduleSnapshotButton, ReprocessScheduleButton, ScheduleImportDialog } from "./schedule-import-dialog";
import { CopyScheduleDiagnosticButton } from "./copy-schedule-diagnostic-button";
import type { FlightScheduleImport } from "@/modules/flight/types";

const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function pdfLink(id: string) { return `/api/flight-schedules/imports/${id}/pdf`; }

function Section({ children }: { children: React.ReactNode }) {
  return <section className="grid gap-5 rounded-2xl border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-5 shadow-sm backdrop-blur-sm sm:p-6">{children}</section>;
}
function Diagnostics({ item }: { item: FlightScheduleImport }) {
  const period = item.document_period_start && item.document_period_end
    ? `${dateFormat.format(new Date(`${item.document_period_start}T00:00:00`))} — ${dateFormat.format(new Date(`${item.document_period_end}T00:00:00`))}` : "Ainda não identificado";
  return <div className="grid gap-2 border-t border-[var(--atlas-border)] pt-4 text-sm">
    <AtlasText variant="label">Diagnóstico do documento</AtlasText>
    <div className="grid grid-cols-2 gap-x-4 gap-y-2"><span className="text-[var(--atlas-muted)]">Tipo</span><span>{item.document_type === "NETLINE_GOL" ? "NetLine GOL" : "Não reconhecido"}</span><span className="text-[var(--atlas-muted)]">Parser</span><span>{item.parser_version ?? "Pendente"}</span><span className="text-[var(--atlas-muted)]">Tripulante</span><span>{[item.crew_id,item.crew_name].filter(Boolean).join(" · ") || "Não identificado"}</span><span className="text-[var(--atlas-muted)]">Base</span><span>{item.home_base ?? "Não identificada"}</span><span className="text-[var(--atlas-muted)]">Período</span><span>{period}</span><span className="text-[var(--atlas-muted)]">Status</span><span>{item.status}</span></div>
    {item.processing_warnings.length ? <details className="text-[var(--atlas-muted)]"><summary className="cursor-pointer">Alertas de extração ({item.processing_warnings.length})</summary><ul className="mt-2 grid gap-1">{item.processing_warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.code}: {warning.message}</li>)}</ul></details> : null}
  </div>;
}
type ActivityData = { counts: Record<string, number>; codes: Record<string, number>; legends: Array<{ code: string; description: string | null }>; days: Array<{ id: string; date: string; rawText: string; events: Array<{ type: string; code: string; label: string | null; start: string | null; end: string | null; location: string | null; rawText: string; outsideHomebaseTimezone: boolean }> }> };
function ActivityDiagnostics({ data }: { data: ActivityData | undefined }) { if (!data) return null; const labels: Array<[string,string]> = [['OFF','Folgas'],['STANDBY','Sobreavisos'],['COURSE','Cursos'],['EVALUATION','Avaliações'],['DEADHEAD','Deadheads'],['CHECK_IN','Check-ins'],['CHECK_OUT','Check-outs'],['UNKNOWN','Desconhecidos']]; return <details className="border-t border-[var(--atlas-border)] pt-4 text-sm"><summary className="cursor-pointer font-semibold">Atividades identificadas</summary><div className="mt-3 grid grid-cols-2 gap-2">{labels.map(([key,label])=><div key={key} className="contents"><span className="text-[var(--atlas-muted)]">{label}</span><span>{data.counts[key] ?? 0}</span></div>)}</div><p className="mt-3 text-[var(--atlas-muted)]">Códigos: {Object.entries(data.codes).map(([code,count])=>`${code} (${count})`).join(' · ') || 'Nenhum'}</p><details className="mt-3 text-[var(--atlas-muted)]"><summary className="cursor-pointer">Legenda do documento</summary><ul className="mt-2 grid gap-1">{data.legends.map(legend=><li key={legend.code}>{legend.code} — {legend.description ?? 'Sem descrição identificada'}</li>)}</ul></details><details className="mt-3 text-[var(--atlas-muted)]"><summary className="cursor-pointer">Dias e texto bruto</summary><div className="mt-3 grid gap-3">{data.days.filter(day=>day.events.length).map(day=><details key={day.id} className="rounded-lg border border-[var(--atlas-border)] p-3"><summary className="cursor-pointer font-medium">{dateFormat.format(new Date(`${day.date}T00:00:00`))} · {day.events.length} evento(s)</summary><ul className="mt-3 grid gap-2">{day.events.map((event,index)=><li key={`${event.code}-${index}`}><span className="font-medium">{event.label ?? event.type}</span> · {event.code}{event.location ? ` · ${event.location}` : ''}{event.start ? ` · ${event.start}` : ''}{event.end ? ` – ${event.end}` : ''}{event.outsideHomebaseTimezone ? ' · fora do fuso da base' : ''}<pre className="mt-1 whitespace-pre-wrap text-[var(--atlas-muted)]">{event.rawText}</pre></li>)}</ul><details className="mt-2"><summary className="cursor-pointer">Texto bruto do dia</summary><pre className="mt-2 whitespace-pre-wrap">{day.rawText}</pre></details></details>)}</div></details></details>; }

export function ScheduleMonthView({ year, month, planned, current, snapshots, activityData }: {
  year: number;
  month: number;
  planned: FlightScheduleImport | null;
  current: FlightScheduleImport | null;
  snapshots: FlightScheduleImport[];
  activityData: Record<string, ActivityData>;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
      <Section>
        <header className="grid gap-1 border-b border-[var(--atlas-border)] pb-4">
          <AtlasText variant="label" className="text-[var(--atlas-blue)]">Escala planejada</AtlasText>
          <AtlasText variant="sectionTitle">Publicação original do mês</AtlasText>
        </header>
        {planned ? <div className="grid gap-4">
          <div className="grid gap-1"><AtlasText variant="caption">Arquivo</AtlasText><AtlasText variant="bodyStrong">{planned.original_filename}</AtlasText></div>
          <div className="grid gap-1"><AtlasText variant="caption">Importada</AtlasText><AtlasText variant="body">{dateFormat.format(new Date(planned.uploaded_at))}</AtlasText></div>
          <Diagnostics item={planned} />
          <ActivityDiagnostics data={activityData[planned.id]} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--atlas-border)] pt-4"><AtlasText variant="caption">Armazenada · baseline imutável</AtlasText><div className="flex items-center gap-4"><CopyScheduleDiagnosticButton importId={planned.id} /><ReprocessScheduleButton importId={planned.id} label="Reprocessar escala planejada" /><Link href={pdfLink(planned.id)} target="_blank" className="text-sm font-semibold text-[var(--atlas-blue)]">Visualizar PDF</Link></div></div>
        </div> : <div className="grid gap-4"><AtlasText variant="body">Nenhuma escala planejada importada.</AtlasText><div><ScheduleImportDialog year={year} month={month} role="PLANNED" /></div></div>}
      </Section>
      <Section>
        <header className="grid gap-1 border-b border-[var(--atlas-border)] pb-4">
          <AtlasText variant="label" className="text-[var(--atlas-blue)]">Escala atual</AtlasText>
          <AtlasText variant="sectionTitle">Atualizações operacionais do mês</AtlasText>
        </header>
        {!planned ? <AtlasText variant="body">Importe primeiro a escala planejada para começar o histórico operacional.</AtlasText> : current ? <div className="grid gap-4">
          <div className="grid gap-1"><AtlasText variant="caption">Última atualização</AtlasText><AtlasText variant="bodyStrong">{dateTimeFormat.format(new Date(current.uploaded_at))}</AtlasText></div>
          <div className="grid gap-1"><AtlasText variant="caption">Snapshot</AtlasText><AtlasText variant="body">{current.snapshot_number}</AtlasText></div>
          <div className="grid gap-1"><AtlasText variant="caption">Arquivo</AtlasText><AtlasText variant="bodyStrong">{current.original_filename}</AtlasText></div>
          <Diagnostics item={current} />
          <ActivityDiagnostics data={activityData[current.id]} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--atlas-border)] pt-4"><div className="flex items-center gap-4"><CopyScheduleDiagnosticButton importId={current.id} /><ReprocessScheduleButton importId={current.id} label="Reprocessar escala atual" /><Link href={pdfLink(current.id)} target="_blank" className="text-sm font-semibold text-[var(--atlas-blue)]">Visualizar PDF</Link><DeleteScheduleSnapshotButton importId={current.id} /></div><ScheduleImportDialog year={year} month={month} role="EXECUTION_SNAPSHOT" /></div>
        </div> : <div className="grid gap-4"><AtlasText variant="body">Nenhuma atualização importada ainda.</AtlasText><div><ScheduleImportDialog year={year} month={month} role="EXECUTION_SNAPSHOT" /></div></div>}
        {snapshots.length ? <div className="grid gap-3 border-t border-[var(--atlas-border)] pt-5"><AtlasText variant="label">Histórico</AtlasText><ol className="grid gap-2">{snapshots.map(snapshot => <li key={snapshot.id} className="flex items-center justify-between gap-4 text-sm"><span className="text-[var(--atlas-muted)]">{dateFormat.format(new Date(snapshot.uploaded_at))}</span><span className="flex items-center gap-3"><Link href={pdfLink(snapshot.id)} target="_blank" className="font-medium text-[var(--atlas-text)]">Snapshot {snapshot.snapshot_number}</Link><DeleteScheduleSnapshotButton importId={snapshot.id} /></span></li>)}</ol></div> : null}
      </Section>
    </div>
  );
}
