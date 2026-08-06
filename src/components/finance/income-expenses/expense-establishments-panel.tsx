"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ClientSearchForm } from "@/components/navigation/client-navigation";
import {
  establishmentInsight,
  sortEstablishmentAnalyses,
  type EstablishmentAnalysis,
} from "@/modules/finance/expense-establishment-analysis";

type Order = "highest" | "lowest" | "count" | "above_median" | "name";

const money = (cents: number | null) => cents === null ? "Histórico insuficiente" :
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const number = (value: number | null) => value === null ? "Histórico insuficiente" :
  new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
const monthLabel = (month: string) => new Intl.DateTimeFormat("pt-BR", {
  month: "short", year: "numeric", timeZone: "UTC",
}).format(new Date(month + "-01T12:00:00Z"));
const dateLabel = (date: string | null) => date ? new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
}).format(new Date(date + "T12:00:00Z")) : "Sem movimentações";

function comparison(item: EstablishmentAnalysis) {
  if (item.comparison === "none") return { label: "Sem movimentação", tone: "muted" };
  if (item.comparison === "insufficient") return { label: "Histórico insuficiente", tone: "muted" };
  if (item.comparison === "within") return { label: "Dentro do habitual", tone: "neutral" };
  const percentage = Math.abs((item.comparisonPercent ?? 0) * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  });
  return {
    label: percentage + "% " + (item.comparison === "above" ? "acima da mediana" : "abaixo da mediana"),
    tone: item.comparison === "above" ? "above" : "below",
  };
}

function EstablishmentCharts({ item, month }: { item: EstablishmentAnalysis; month: string }) {
  const history = item.monthlyHistory.slice(0, 12).reverse().map(row => ({
    ...row,
    label: monthLabel(row.month),
    selected: row.month === month,
  }));
  if (!history.length) return <p className="eventual-empty-chart">Sem movimentações reconhecidas para exibir no gráfico.</p>;
  return <div className="eventual-charts">
    <section><header><h3>Gasto mensal</h3><small>Últimos meses com movimentação</small></header><div className="eventual-chart">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={history}>
        <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--atlas-muted)", fontSize: 12 }} />
        <YAxis hide />
        <Tooltip formatter={value => money(Number(value ?? 0))} />
        {item.medianMonthlyCents !== null ? <ReferenceLine y={item.medianMonthlyCents} stroke="var(--atlas-muted)" strokeDasharray="4 4" /> : null}
        <Bar dataKey="totalCents" fill="var(--atlas-blue)" radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </div></section>
    <section><header><h3>Frequência</h3><small>Pagamentos reconhecidos por mês</small></header><div className="eventual-chart small">
      <ResponsiveContainer width="100%" height="100%"><BarChart data={history}>
        <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--atlas-muted)", fontSize: 12 }} />
        <YAxis hide />
        <Tooltip formatter={value => number(Number(value ?? 0)) + " pagamentos"} />
        {item.medianFrequency !== null ? <ReferenceLine y={item.medianFrequency} stroke="var(--atlas-muted)" strokeDasharray="4 4" /> : null}
        <Bar dataKey="count" fill="var(--atlas-success)" radius={[4, 4, 0, 0]} />
      </BarChart></ResponsiveContainer>
    </div></section>
  </div>;
}

function EstablishmentDrawer({
  item,
  month,
  onClose,
}: {
  item: EstablishmentAnalysis;
  month: string;
  onClose: () => void;
}) {
  const selectedPayments = item.transactions.filter(transaction => transaction.date.slice(0, 7) === month);
  const current = comparison(item);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return <div className="eventual-modal-backdrop" onMouseDown={onClose}>
    <aside className="eventual-drawer" role="dialog" aria-modal="true"
      aria-label={"Detalhes de " + item.name} onMouseDown={event => event.stopPropagation()}>
    <header><div><p className="eyebrow">Despesas eventuais</p><h2>{item.name}</h2>
      <p>{item.categoryName ?? "Sem categoria"} · Histórico desde {dateLabel(item.firstDate)} · {item.historyMonths} meses considerados</p>
    </div><button type="button" onClick={onClose} aria-label="Fechar detalhes">×</button></header>
    <div className="eventual-drawer-body">
      <dl className="eventual-detail-summary"><div><dt>Valor no mês</dt><dd>{money(item.monthTotalCents)}</dd></div><div><dt>Mediana mensal</dt><dd>{money(item.medianMonthlyCents)}</dd></div><div><dt>Qtd. no mês</dt><dd>{item.monthCount}</dd></div><div><dt>Frequência mediana</dt><dd>{number(item.medianFrequency)}</dd></div></dl>
      <p className={"eventual-comparison " + current.tone}>{current.label}</p>
      <p className="eventual-insight">{establishmentInsight(item)}</p>
      <EstablishmentCharts item={item} month={month} />
      <section className="eventual-drawer-section"><h3>Histórico mensal</h3><div className="eventual-history">
        <div><span>Mês</span><span>Valor total</span><span>Qtd.</span><span>Valor médio</span></div>
        {item.monthlyHistory.map(row => <div key={row.month}><span>{monthLabel(row.month)}</span><strong>{money(row.totalCents)}</strong><span>{row.count}</span><strong>{row.count ? money(Math.round(row.totalCents / row.count)) : "—"}</strong></div>)}
      </div></section>
      <section className="eventual-drawer-section"><h3>Pagamentos reconhecidos · {monthLabel(month)}</h3>
        {selectedPayments.length ? <div className="eventual-payments">{selectedPayments.map(row => <article key={row.id}><time>{dateLabel(row.date)}</time><span><b>{row.description}</b><small>{row.sourceLabel}</small></span><strong>{money(row.amountCents)}</strong></article>)}</div> : <p>Nenhum pagamento reconhecido neste mês.</p>}
      </section>
      <details className="eventual-rules"><summary>Regras de reconhecimento</summary><div><b>Nome principal</b><span>{item.name}</span><b>Aliases</b><span>{item.aliases.length ? item.aliases.join(" · ") : "Nenhum alias ativo"}</span><p>Para corrigir ou desvincular uma associação, abra a movimentação correspondente.</p></div></details>
    </div>
    </aside>
  </div>;
}

export function ExpenseEstablishmentsPanel({
  items,
  workspaceId,
  month,
  search,
  order,
  selectedId,
}: {
  items: EstablishmentAnalysis[];
  workspaceId: string;
  month: string;
  search: string;
  order: Order;
  selectedId?: string;
}) {
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const openedByPanel = useRef(false);
  const visible = useMemo(() => sortEstablishmentAnalyses(items.filter(item => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return !needle || [item.name, ...item.aliases].some(value => value.toLocaleLowerCase("pt-BR").includes(needle));
  }), order), [items, order, search]);
  const selected = items.find(item => item.id === (openId === undefined ? selectedId : openId));
  const query = (next: { establishment?: string; order?: Order }) => {
    const params = new URLSearchParams({ workspace: workspaceId, month, tab: "eventual" });
    if (search) params.set("eventual_search", search);
    if ((next.order ?? order) !== "highest") params.set("eventual_order", next.order ?? order);
    if (next.establishment) params.set("eventual_establishment", next.establishment);
    return ("/financeiro/receitas-despesas?" + params) as `/${string}`;
  };
  useEffect(() => {
    const onPopState = () => {
      setOpenId(new URL(window.location.href).searchParams.get("eventual_establishment"));
      openedByPanel.current = false;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const open = (id: string) => {
    window.history.pushState(null, "", query({ establishment: id }));
    openedByPanel.current = true;
    setOpenId(id);
  };
  const close = () => {
    if (openedByPanel.current) {
      openedByPanel.current = false;
      window.history.back();
      return;
    }
    window.history.replaceState(null, "", query({}));
    setOpenId(null);
  };
  return <section className="eventual-panel">
    <ClientSearchForm action="/financeiro/receitas-despesas" className="eventual-controls">
      <input type="hidden" name="workspace" value={workspaceId} /><input type="hidden" name="month" value={month} /><input type="hidden" name="tab" value="eventual" />
      <label><span>Buscar estabelecimento</span><input name="eventual_search" defaultValue={search} placeholder="Nome ou alias reconhecido" /></label>
      <label><span>Ordenar</span><select name="eventual_order" defaultValue={order}><option value="highest">Maior valor</option><option value="lowest">Menor valor</option><option value="count">Maior quantidade</option><option value="above_median">Acima da mediana</option><option value="name">Ordem alfabética</option></select></label>
      <button className="finance-button">Aplicar</button>
    </ClientSearchForm>
    <div className="eventual-list">
      <div className="eventual-list-head"><span>Estabelecimento</span><span>Valor no mês</span><span>Mediana mensal</span><span>Qtd. no mês</span><span title="Mediana da quantidade de pagamentos reconhecidos nos meses considerados.">Frequência mediana</span></div>
      {visible.map(item => { const status = comparison(item); return <button type="button" key={item.id} onClick={() => open(item.id)}><span className="eventual-name"><b>{item.name}</b><small>{item.categoryName ?? "Sem categoria"}</small></span><span data-label="Valor no mês"><strong>{money(item.monthTotalCents)}</strong><small className={status.tone}>{status.label}</small></span><strong data-label="Mediana mensal">{money(item.medianMonthlyCents)}</strong><strong data-label="Qtd. no mês">{item.monthCount}</strong><strong data-label="Frequência mediana">{number(item.medianFrequency)}</strong></button>; })}
      {!visible.length ? <p className="eventual-empty">Nenhum estabelecimento encontrado.</p> : null}
    </div>
    {selected ? <EstablishmentDrawer item={selected} month={month} onClose={close} /> : null}
  </section>;
}
