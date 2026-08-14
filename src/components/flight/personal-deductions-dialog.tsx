"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AtlasModal, AtlasModalBody, AtlasModalClose, AtlasModalFooter, AtlasModalHeader } from "@/components/ui/atlas-modal";
import { AtlasText } from "@/components/ui/atlas-text";
import { parseBrlToCents } from "@/modules/flight/financial/personal-deductions";

type Item = {
  id: string;
  deductionGroupId: string;
  name: string;
  category: string;
  calculationType: string;
  amountMinorUnits: number;
  deductibleFromIrrfBase: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
};

type FormState = { name: string; amount: string; effectiveFrom: string; deductible: boolean; notes: string };
type View = { kind: "list" } | { kind: "add" } | { kind: "edit"; item: Item } | { kind: "end"; item: Item };
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const monthLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value.slice(0, 7)}-01T12:00:00Z`)).replace(" de ", "/").replace(".", "").toUpperCase();
const amountText = (value: number) => (value / 100).toFixed(2).replace(".", ",");
const inputClass = "min-h-10 w-full rounded-lg border border-[var(--atlas-border)] bg-[var(--atlas-card)] px-3 text-[var(--atlas-text)] outline-none focus:border-[var(--atlas-blue)]";
const emptyForm = (competence: string): FormState => ({ name: "", amount: "", effectiveFrom: competence, deductible: false, notes: "" });

export function PersonalDeductionsDialog({ year, month }: { year: number; month: number }) {
  const router = useRouter();
  const competence = `${year}-${String(month).padStart(2, "0")}`;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<Item[]>([]);
  const [view, setView] = useState<View>({ kind: "list" });
  const [form, setForm] = useState<FormState>(() => emptyForm(competence));
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => { if (!busy) { setOpen(false); setView({ kind: "list" }); setError(null); } }, [busy]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/flight-payroll-deductions?competence=${competence}`, { cache: "no-store" });
      const body = await response.json() as { items?: Item[]; history?: Item[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os descontos pessoais.");
      setItems(body.items ?? []); setHistory(body.history ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os descontos pessoais."); }
    finally { setLoading(false); }
  }, [competence]);

  const selectedHistory = useMemo(() => view.kind === "edit" ? history.filter(item => item.deductionGroupId === view.item.deductionGroupId) : [], [history, view]);

  function beginAdd() { setForm(emptyForm(competence)); setView({ kind: "add" }); setMessage(null); setError(null); }
  function beginEdit(item: Item) { setForm({ name: item.name, amount: amountText(item.amountMinorUnits), effectiveFrom: competence, deductible: item.deductibleFromIrrfBase, notes: item.notes ?? "" }); setView({ kind: "edit", item }); setMessage(null); setError(null); }
  function beginEnd(item: Item) { setForm(current => ({ ...current, effectiveFrom: competence })); setView({ kind: "end", item }); setMessage(null); setError(null); }

  async function mutate() {
    const amountMinorUnits = parseBrlToCents(form.amount);
    if (view.kind !== "end" && (!form.name.trim() || amountMinorUnits === null)) { setError("Informe o nome e um valor mensal válido."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const method = view.kind === "add" ? "POST" : "PATCH";
      const body = view.kind === "end"
        ? { action: "end", id: view.item.id, stopsFrom: `${form.effectiveFrom}-01`, competence }
        : { action: view.kind === "edit" ? "version" : undefined, id: view.kind === "edit" ? view.item.id : undefined, competence, name: form.name.trim(), category: "OTHER", calculationType: "FIXED", amountMinorUnits, percentageBasisPoints: null, baseType: null, deductibleFromIrrfBase: form.deductible, effectiveFrom: `${form.effectiveFrom}-01`, effectiveTo: null, notes: form.notes.trim() || null };
      const response = await fetch("/api/flight-payroll-deductions", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Não foi possível salvar o desconto.");
      setMessage(view.kind === "add" ? "Desconto adicionado." : view.kind === "edit" ? "Nova vigência salva." : "Desconto encerrado.");
      setView({ kind: "list" }); await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o desconto."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" title="Configurar descontos pessoais" aria-label="Configurar descontos pessoais" onClick={() => { setOpen(true); void load(); }} className="grid h-9 w-9 place-items-center rounded-lg text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-blue)]/10 hover:text-[var(--atlas-blue)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--atlas-blue)]">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z"/><path d="M19.1 13.5a7.5 7.5 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L13.8 2h-4l-.4 3.1a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.5 7.5 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5l.4 3.1h4l.4-3.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2.1-1.5Z"/></svg>
    </button>
    <AtlasModal open={open} onClose={close} title="Descontos pessoais" description="Configure os descontos utilizados na estimativa do seu salário líquido." focusKey={view.kind}>
      <AtlasModalHeader><div><AtlasText variant="modalTitle">Descontos pessoais</AtlasText><AtlasText variant="secondary" className="mt-1">Configure os descontos utilizados na estimativa do seu salário líquido.</AtlasText><p className="mt-2 text-sm font-medium text-[var(--atlas-blue)]">Competência: {monthLabel(`${competence}-01`)}</p></div><AtlasModalClose disabled={busy}/></AtlasModalHeader>
      <AtlasModalBody className="grid gap-4">
        {message ? <p role="status" className="rounded-lg bg-emerald-400/10 px-3 py-2 text-sm text-emerald-400">{message}</p> : null}
        {error ? <p role="alert" className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-400">{error}</p> : null}
        {view.kind === "list" ? <>
          {loading ? <p className="py-6 text-center text-sm text-[var(--atlas-muted)]">Carregando descontos…</p> : items.length ? <div className="divide-y divide-[var(--atlas-border)]">{items.map(item => <article key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{item.name}</h3><p className="mt-0.5 text-base font-medium tabular-nums">{money(item.amountMinorUnits)}</p><p className="mt-0.5 text-sm text-[var(--atlas-muted)]">{item.deductibleFromIrrfBase ? "Dedutível do IR" : "Não dedutível"} · desde {monthLabel(item.effectiveFrom)}</p></div><div className="flex gap-4 text-sm">{item.calculationType === "FIXED" ? <button type="button" onClick={() => beginEdit(item)} className="text-[var(--atlas-blue)]">Editar</button> : <span className="text-[var(--atlas-muted)]">Regra percentual</span>}<button type="button" onClick={() => beginEnd(item)} className="text-[var(--atlas-muted)] hover:text-red-400">Encerrar</button></div></article>)}</div> : <p className="py-6 text-center text-sm text-[var(--atlas-muted)]">Nenhum desconto pessoal cadastrado para esta competência.</p>}
          <button type="button" onClick={beginAdd} className="w-fit text-sm font-semibold text-[var(--atlas-blue)]">+ Adicionar desconto</button>
        </> : view.kind === "end" ? <div className="grid gap-4"><p className="text-sm">Encerrar <b>“{view.item.name}”</b> a partir de qual competência?</p><Field label="Deixa de valer a partir de"><input data-autofocus type="month" value={form.effectiveFrom} onChange={event => setForm({ ...form, effectiveFrom: event.target.value })} className={inputClass}/></Field><p className="text-sm text-[var(--atlas-muted)]">A vigência anterior será preservada até o mês imediatamente anterior.</p></div> : <DeductionForm form={form} setForm={setForm} editing={view.kind === "edit"} history={selectedHistory}/>} 
      </AtlasModalBody>
      <AtlasModalFooter>{view.kind === "list" ? <button type="button" onClick={close} className="entity-secondary-button">Fechar</button> : <><button type="button" disabled={busy} onClick={() => { setView({ kind: "list" }); setError(null); }} className="entity-secondary-button">Cancelar</button><button type="button" disabled={busy || !form.effectiveFrom} onClick={() => void mutate()}>{busy ? "Salvando…" : view.kind === "add" ? "Salvar desconto" : view.kind === "edit" ? "Salvar nova vigência" : "Encerrar desconto"}</button></>}</AtlasModalFooter>
    </AtlasModal>
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="grid gap-1.5 text-sm text-[var(--atlas-muted)]"><span>{label}</span>{children}</label>; }
function DeductionForm({ form, setForm, editing, history }: { form: FormState; setForm: (value: FormState) => void; editing: boolean; history: Item[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <Field label="Nome do desconto"><input data-autofocus={!editing || undefined} value={form.name} maxLength={120} onChange={event => setForm({ ...form, name: event.target.value })} className={inputClass} placeholder="Plano de saúde"/></Field>
    <Field label={editing ? "Novo valor" : "Valor mensal"}><input inputMode="decimal" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} className={inputClass} placeholder="R$ 0,00"/></Field>
    <Field label={editing ? "Aplicar a partir de" : "Vigência a partir de"}><input type="month" value={form.effectiveFrom} onChange={event => setForm({ ...form, effectiveFrom: event.target.value })} className={inputClass}/></Field>
    <fieldset className="grid gap-2"><legend className="text-sm text-[var(--atlas-muted)]">Dedutível do Imposto de Renda?</legend><div className="flex gap-5 text-sm"><label className="flex items-center gap-2"><input type="radio" checked={!form.deductible} onChange={() => setForm({ ...form, deductible: false })}/> Não</label><label className="flex items-center gap-2"><input type="radio" checked={form.deductible} onChange={() => setForm({ ...form, deductible: true })}/> Sim</label></div></fieldset>
    <Field label="Observação (opcional)"><textarea value={form.notes} maxLength={500} onChange={event => setForm({ ...form, notes: event.target.value })} className={`${inputClass} min-h-20 py-2 sm:col-span-2`}/></Field>
    <p className="text-sm leading-5 text-[var(--atlas-muted)] sm:col-span-2">Quando marcado, o Atlas considera este valor entre as deduções informadas para estimar a base do IRRF.</p>
    {editing ? <p className="rounded-lg bg-[var(--atlas-blue)]/8 px-3 py-2 text-sm text-[var(--atlas-muted)] sm:col-span-2">Esta alteração valerá a partir da competência selecionada. Os meses anteriores permanecerão inalterados.</p> : null}
    {editing && history.length ? <details className="text-sm sm:col-span-2"><summary className="cursor-pointer font-medium text-[var(--atlas-blue)]">Histórico</summary><div className="mt-2 grid gap-1.5">{history.map(item => <p key={item.id} className="text-[var(--atlas-muted)]">{monthLabel(item.effectiveFrom)} – {item.effectiveTo ? monthLabel(item.effectiveTo) : "atual"} · {money(item.amountMinorUnits)} · {item.deductibleFromIrrfBase ? "Dedutível" : "Não dedutível"}</p>)}</div></details> : null}
  </div>;
}
