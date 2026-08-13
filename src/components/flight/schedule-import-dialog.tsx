"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AtlasModal, AtlasModalBody, AtlasModalClose, AtlasModalFooter, AtlasModalHeader } from "@/components/ui/atlas-modal";
import { AtlasText } from "@/components/ui/atlas-text";

type ImportRole = "PLANNED" | "EXECUTION_SNAPSHOT";

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
  async function reprocess() {
    setProcessing(true);
    try {
      await fetch(`/api/flight-schedules/imports/${importId}/reprocess`, { method: "POST" });
      router.refresh();
    } finally { setProcessing(false); }
  }
  return <button type="button" aria-label={label} disabled={processing} onClick={reprocess} className="text-sm font-medium text-[var(--atlas-muted)] underline-offset-4 hover:text-[var(--atlas-text)] hover:underline disabled:opacity-50">{processing ? "Processando..." : "Reprocessar"}</button>;
}

export function CopyScheduleDiagnosticButton({ importId }: { importId: string }) {
  const [copied,setCopied]=useState(false);
  async function copy(){ const response=await fetch(`/api/flight-schedules/imports/${importId}/diagnostics`); if(!response.ok)return; const data=await response.json() as { filename:string; parserVersion:string|null; counts:Record<string,number>; eventCodes:Record<string,number>; legends:Array<{code:string;description:string|null}>; deferred:number }; const text=[data.filename,`Parser: ${data.parserVersion??'Pendente'}`,'',...['OFF','STANDBY','COURSE','EVALUATION','DEADHEAD','CHECK_IN','CHECK_OUT','GROUND_ACTIVITY','UNKNOWN'].map(key=>`${key}: ${data.counts[key]??0}`),`DEFERRED: ${data.deferred}`,'','EVENT CODES',...Object.entries(data.eventCodes).map(([code,count])=>`${code}: ${count}`),'','LEGENDA',...data.legends.map(item=>`${item.code} = ${item.description??'Sem descrição identificada'}`)].join('\n'); await navigator.clipboard.writeText(text); setCopied(true); setTimeout(()=>setCopied(false),2000); }
  return <button type="button" onClick={copy} className="text-sm font-medium text-[var(--atlas-muted)] underline-offset-4 hover:text-[var(--atlas-text)] hover:underline">{copied?'Diagnóstico copiado':'Copiar diagnóstico'}</button>;
}

export function ScheduleImportDialog({ year, month, role }: { year: number; month: number; role: ImportRole }) {
  const router = useRouter();
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
      router.refresh();
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
