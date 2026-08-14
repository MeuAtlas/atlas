"use client";

import { useRef, useState } from "react";
import { useClientNavigation } from "@/components/navigation/client-navigation";
import { useRouter } from "next/navigation";
import { AtlasModal, AtlasModalBody, AtlasModalClose, AtlasModalFooter, AtlasModalHeader } from "@/components/ui/atlas-modal";
import { AtlasText } from "@/components/ui/atlas-text";

type ImportRole = "PLANNED" | "EXECUTION_SNAPSHOT";

export function UpdateScheduleDialog({ year, month, hasPlanned, hasExecuted, compact = false }: { year: number; month: number; hasPlanned: boolean; hasExecuted: boolean; compact?: boolean }) {
  const navigate = useClientNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false); const [role, setRole] = useState<ImportRole>("EXECUTION_SNAPSHOT"); const [file, setFile] = useState<File | null>(null); const [message, setMessage] = useState<string | null>(null); const [sending, setSending] = useState(false);
  const planned = role === "PLANNED";
  const title = planned ? (hasPlanned ? "Substituir planejada" : "Enviar planejada") : (hasExecuted ? "Atualizar executada" : "Enviar executada");
  async function submit(confirmDocumentCompetence = false) { if (!file) return; setSending(true); setMessage("Processando escala…"); const data = new FormData(); data.set("file", file); data.set("year", String(year)); data.set("month", String(month)); data.set("role", role); if (confirmDocumentCompetence) data.set("confirmDocumentCompetence", "true"); try { const response = await fetch("/api/flight-schedules/imports", { method: "POST", body: data }); const body: { status?: string; competence?: { year: number; month: number }; detectedCompetence?: { year: number; month: number }; error?: { code?: string; message?: string } } = await response.json(); if (response.status === 409 && body.error?.code === "DOCUMENT_COMPETENCE_MISMATCH" && body.detectedCompetence) { const detected = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(new Date(body.detectedCompetence.year, body.detectedCompetence.month - 1, 1)); if (window.confirm(`${body.error.message}\n\nImportar para ${detected}?`)) { await submit(true); return; } setMessage("Importação cancelada: a competência documental não corresponde ao mês visualizado."); return; } if (!response.ok) { setMessage(body.error?.message ?? "Não foi possível atualizar a escala."); return; } setFile(null); const target = body.competence ?? { year, month }; navigate(`/escala?month=${target.year}-${String(target.month).padStart(2, "0")}`); setMessage(body.status === "existing" ? "Este arquivo já está cadastrado nesta competência." : "Escala atualizada."); } catch { setMessage("Não foi possível atualizar a escala. Tente novamente."); } finally { setSending(false); } }
  return <><button type="button" title="Atualizar escala" aria-label="Atualizar escala" onClick={() => setOpen(true)} className={compact ? "grid h-9 w-9 place-items-center rounded-lg text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-blue)]/10 hover:text-[var(--atlas-blue)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--atlas-blue)]" : "rounded-xl bg-[var(--atlas-blue)] px-4 py-2.5 text-sm font-semibold text-white"}>{compact ? <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="M19.1 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L13.8 2h-4l-.4 3.1a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 3.1h4l.4-3.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2.1-1.5Z"/></svg> : "Atualizar escala"}</button><AtlasModal open={open} onClose={() => !sending && setOpen(false)} title="Atualizar escala" description="Escolha qual versão deseja enviar."><AtlasModalHeader className="flex items-start justify-between gap-4"><div><AtlasText variant="modalTitle">Atualizar escala</AtlasText><AtlasText variant="secondary" className="mt-2">O que deseja enviar?</AtlasText></div><AtlasModalClose disabled={sending} /></AtlasModalHeader><AtlasModalBody className="grid gap-4"><div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => setRole("PLANNED")} className={`rounded-xl border p-3 text-left ${planned ? "border-[var(--atlas-blue)] bg-[var(--atlas-blue)]/10" : "border-[var(--atlas-border)]"}`}><b>Escala planejada</b><span className="mt-1 block text-sm text-[var(--atlas-muted)]">A publicação original do mês.</span></button><button type="button" onClick={() => setRole("EXECUTION_SNAPSHOT")} className={`rounded-xl border p-3 text-left ${!planned ? "border-[var(--atlas-blue)] bg-[var(--atlas-blue)]/10" : "border-[var(--atlas-border)]"}`}><b>Escala executada</b><span className="mt-1 block text-sm text-[var(--atlas-muted)]">A versão operacional mais recente.</span></button></div>{(planned && hasPlanned) || (!planned && hasExecuted) ? <p className="text-sm text-amber-400">{planned ? "A nova escala substituirá a baseline atual após validação." : "A nova escala substituirá a Executada atual após validação."}</p> : null}<input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files?.[0] ?? null)} /><button type="button" disabled={sending} onClick={() => inputRef.current?.click()} className="grid min-h-28 place-items-center rounded-xl border border-dashed border-[var(--atlas-border)] p-4 text-center"><span><b>{file?.name ?? "Selecionar PDF"}</b><small className="mt-1 block text-[var(--atlas-muted)]">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "PDF de até 20 MB"}</small></span></button>{message ? <p role={message.includes("atualizada") ? "status" : "alert"} className="text-sm text-[var(--atlas-muted)]">{message}</p> : null}</AtlasModalBody><AtlasModalFooter className="flex justify-end gap-3"><button type="button" disabled={sending} onClick={() => setOpen(false)} className="px-3 py-2 text-sm">Cancelar</button><button type="button" disabled={!file || sending} onClick={() => void submit()} className="rounded-xl bg-[var(--atlas-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{sending ? "Processando escala…" : title}</button></AtlasModalFooter></AtlasModal></>;
}

export function DeleteScheduleSnapshotButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm("Excluir este PDF de atualização? Esta ação não pode ser desfeita.")) return;
    setDeleting(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/flight-schedules/imports/${importId}`, { method: "DELETE" });
      const body: { storageRemoved?: boolean; error?: { message?: string } } = await response.json();
      if (!response.ok) {
        setMessage(body.error?.message ?? "Não foi possível excluir esta atualização.");
        return;
      }
      setMessage(body.storageRemoved === false
        ? "A atualização foi removida, mas o PDF precisará de limpeza administrativa."
        : null);
      router.refresh();
    } catch {
      setMessage("Não foi possível excluir esta atualização. Tente novamente.");
    } finally {
      setDeleting(false);
    }
  }

  return <span className="inline-flex items-center gap-2"><button type="button" disabled={deleting} onClick={remove} className="text-sm font-medium text-[var(--atlas-muted)] underline-offset-4 hover:text-[var(--atlas-error)] hover:underline disabled:opacity-50">{deleting ? "Excluindo..." : "Excluir"}</button>{message ? <small role="alert" className="text-[var(--atlas-error)]">{message}</small> : null}</span>;
}

export function ReprocessScheduleButton({ importId, label = "Reprocessar" }: { importId: string; label?: string }) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function reprocess() {
    setProcessing(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/flight-schedules/imports/${importId}/reprocess`, { method: "POST" });
      const body = await response.json() as { status?: string; error?: { message?: string } };
      if (!response.ok) {
        setMessage(body.status === "incomplete" ? "O PDF continua incompleto após o reprocessamento." : body.error?.message ?? "Não foi possível reprocessar a escala.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("Não foi possível reprocessar a escala.");
    } finally { setProcessing(false); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" aria-label={label} disabled={processing} onClick={reprocess} className="text-sm font-medium text-[var(--atlas-muted)] underline-offset-4 hover:text-[var(--atlas-text)] hover:underline disabled:opacity-50">{processing ? "Processando..." : "Reprocessar"}</button>{message ? <small role="alert" className="text-amber-400">{message}</small> : null}</span>;
}

export function CopyScheduleDiagnosticButton({ importId }: { importId: string }) {
  const [copied,setCopied]=useState(false);
  async function copy(){ const response=await fetch(`/api/flight-schedules/imports/${importId}/diagnostics`); if(!response.ok)return; const data=await response.json() as { filename:string; parserVersion:string|null; counts:Record<string,number>; eventCodes:Record<string,number>; legends:Array<{code:string;description:string|null}>; deferred:number }; const text=[data.filename,`Parser: ${data.parserVersion??'Pendente'}`,'',...['OFF','STANDBY','COURSE','EVALUATION','DEADHEAD','CHECK_IN','CHECK_OUT','GROUND_ACTIVITY','UNKNOWN'].map(key=>`${key}: ${data.counts[key]??0}`),`DEFERRED: ${data.deferred}`,'','EVENT CODES',...Object.entries(data.eventCodes).map(([code,count])=>`${code}: ${count}`),'','LEGENDA',...data.legends.map(item=>`${item.code} = ${item.description??'Sem descrição identificada'}`)].join('\n'); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000); }
  return <button type="button" onClick={copy} className="text-sm font-medium text-[var(--atlas-muted)] underline-offset-4 hover:text-[var(--atlas-text)] hover:underline">{copied?'Diagnóstico copiado':'Copiar diagnóstico'}</button>;
}

export function ScheduleImportDialog({ year, month, role }: { year: number; month: number; role: ImportRole }) {
  const navigate = useClientNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const planned = role === "PLANNED";

  function close() {
    if (sending) return;
    setOpen(false);
    setFile(null);
    setMessage(null);
  }

  async function submit() {
    if (!file) return;
    setSending(true);
    setMessage(null);
    const data = new FormData();
    data.set("file", file);
    data.set("year", String(year));
    data.set("month", String(month));
    data.set("role", role);
    try {
      const response = await fetch("/api/flight-schedules/imports", { method: "POST", body: data });
      const body: { status?: string; error?: { message?: string } } = await response.json();
      if (!response.ok) {
        setMessage(body.error?.message ?? "Não foi possível armazenar a escala.");
        return;
      }
      setMessage(body.status === "existing" ? "Esta escala já foi importada." : "Escala armazenada com sucesso.");
      setFile(null);
      navigate(`/escala?month=${year}-${String(month).padStart(2, "0")}`, "replace");
    } catch {
      setMessage("Não foi possível enviar a escala. Tente novamente.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-[var(--atlas-blue)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--atlas-blue)]">
        {planned ? "Importar planejada" : "Importar nova atualização"}
      </button>
      <AtlasModal open={open} onClose={close} title={planned ? "Importar escala planejada" : "Importar escala atual"} description="Envie o PDF original da sua escala.">
        <AtlasModalHeader className="flex items-start justify-between gap-4">
          <div>
            <AtlasText variant="modalTitle">{planned ? "Importar escala planejada" : "Importar escala atual"}</AtlasText>
            <AtlasText variant="secondary" className="mt-2">O PDF original será mantido privado e preservado no histórico.</AtlasText>
          </div>
          <AtlasModalClose disabled={sending} />
        </AtlasModalHeader>
        <AtlasModalBody className="grid gap-4">
          <input ref={inputRef} className="sr-only" type="file" accept="application/pdf,.pdf" onChange={event => {
            const selected = event.target.files?.[0] ?? null;
            if (selected && (selected.type !== "application/pdf" || !selected.name.toLowerCase().endsWith(".pdf"))) {
              setFile(null); setMessage("Selecione apenas um arquivo PDF."); return;
            }
            if (selected && selected.size > 20 * 1024 * 1024) {
              setFile(null); setMessage("O PDF deve ter até 20 MB."); return;
            }
            setFile(selected); setMessage(null);
          }} />
          <button type="button" disabled={sending} onClick={() => inputRef.current?.click()} className="grid min-h-32 place-items-center rounded-xl border border-dashed border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-5 text-center transition hover:border-[var(--atlas-blue)]">
            <span className="grid gap-1">
              <AtlasText variant="bodyStrong">{file ? file.name : "Selecionar PDF"}</AtlasText>
              <AtlasText variant="caption">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Apenas .pdf, com até 20 MB"}</AtlasText>
            </span>
          </button>
          {message ? <p role={message.includes("sucesso") || message.includes("já foi") ? "status" : "alert"} className="text-sm text-[var(--atlas-muted)]">{message}</p> : null}
        </AtlasModalBody>
        <AtlasModalFooter className="flex items-center justify-end gap-3">
          <button type="button" disabled={sending} onClick={close} className="rounded-xl px-3 py-2 text-sm font-medium text-[var(--atlas-muted)]">Cancelar</button>
          <button type="button" disabled={!file || sending} onClick={submit} className="rounded-xl bg-[var(--atlas-blue)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {sending ? "Enviando escala..." : "Armazenar escala"}
          </button>
        </AtlasModalFooter>
      </AtlasModal>
    </>
  );
}
