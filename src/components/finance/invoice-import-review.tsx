"use client";

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatCents } from "@/modules/finance/invoice-import/money";
import { reconcileInvoice } from "@/modules/finance/invoice-import/reconciliation";
import {
  confidenceLevel,
  type InvoiceEntryType,
  type InvoiceReviewState,
  type ParsedInvoiceEntry,
} from "@/modules/finance/invoice-import/types";

const entryTypes: Array<[InvoiceEntryType, string]> = [
  ["purchase", "Compra"],
  ["installment_purchase", "Compra parcelada"],
  ["credit", "Crédito"],
  ["refund", "Estorno"],
  ["payment", "Pagamento"],
  ["fee", "Tarifa"],
  ["interest", "Juros"],
  ["tax", "Imposto"],
  ["previous_balance", "Saldo anterior"],
  ["adjustment", "Ajuste"],
  ["unknown", "Revisar"],
];

const typeLabels = Object.fromEntries(entryTypes) as Record<InvoiceEntryType, string>;

type ReviewSegment = "all" | "installments" | "single" | "low" | "ignored";
type ReviewSort = "original" | "highest" | "lowest" | "confidence" | "date";

export type InvoiceReviewMetrics = {
  total: number;
  installments: number;
  singlePurchases: number;
  ignored: number;
  averageConfidence: number;
  validatedTotalCents: number | null;
};

export function getInvoiceReviewMetrics(
  review: InvoiceReviewState,
): InvoiceReviewMetrics {
  const entries = review.parsed.entries ?? [];
  const active = entries.filter(entry => !entry.isIgnored);
  return {
    total: entries.length,
    installments: active.filter(entry => entry.installment).length,
    singlePurchases: active.filter(entry =>
      !entry.installment &&
      ["purchase", "unknown"].includes(entry.entryType)
    ).length,
    ignored: entries.length - active.length,
    averageConfidence: entries.length
      ? entries.reduce((sum, entry) => sum + entry.confidence, 0) / entries.length
      : review.parsed.confidence,
    validatedTotalCents: review.parsed.officialTotalCents,
  };
}

function formatDate(value: string | null) {
  if (!value) return "Não informado";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function invoicePeriod(review: InvoiceReviewState) {
  const start = review.parsed.cycleStartDate;
  const end = review.parsed.cycleEndDate;
  if (!start && !end) return "Período não identificado";
  return `${formatDate(start)} — ${formatDate(end)}`;
}

function confidenceLabel(value: number) {
  const level = confidenceLevel(value);
  return level === "high" ? "Alta" : level === "medium" ? "Média" : "Baixa";
}

function ReviewSummary({
  review,
  metrics,
  actions,
}: {
  review: InvoiceReviewState;
  metrics: InvoiceReviewMetrics;
  actions?: ReactNode;
}) {
  const ready = Boolean(
    review.parsed.dueDate && review.parsed.officialTotalCents !== null,
  );
  const cards = new Set(
    review.parsed.entries
      .map(entry => entry.cardLastFour)
      .filter(Boolean),
  );
  const cardDescription = cards.size > 1
    ? `${review.cardName} · ${cards.size} cartões`
    : `${review.cardName}${review.parsed.cardLastFour ? ` · final ${review.parsed.cardLastFour}` : ""}`;

  return (
    <section className="invoice-review-summary" aria-labelledby="invoice-review-title">
      <header>
        <div>
          <p className="eyebrow">{cardDescription}</p>
          <h1 id="invoice-review-title">Revisão da fatura</h1>
          <p>Confira os lançamentos antes de confirmar a importação.</p>
        </div>
        <span className={`invoice-review-status ${ready ? "ready" : "attention"}`}>
          {ready ? "Pronto para confirmar" : "Dados pendentes"}
        </span>
      </header>
      <div className="invoice-review-context">
        <span>{invoicePeriod(review)}</span>
        <span>Vencimento {formatDate(review.parsed.dueDate)}</span>
        <span>{review.originalFilename}</span>
      </div>
      <dl className="invoice-review-metrics">
        <div>
          <dt>Total da fatura</dt>
          <dd>{metrics.validatedTotalCents === null
            ? "Não informado"
            : formatCents(metrics.validatedTotalCents)}</dd>
        </div>
        <div><dt>Lançamentos</dt><dd>{metrics.total}</dd></div>
        <div><dt>Parceladas</dt><dd>{metrics.installments}</dd></div>
        <div><dt>Compras avulsas</dt><dd>{metrics.singlePurchases}</dd></div>
        <div><dt>Ignorados</dt><dd>{metrics.ignored}</dd></div>
        <div>
          <dt>Confiança média</dt>
          <dd>
            <span className={`confidence ${confidenceLevel(metrics.averageConfidence)}`}>
              {Math.round(metrics.averageConfidence * 100)}%
            </span>
          </dd>
        </div>
      </dl>
      {actions ? <div className="invoice-review-utility">{actions}</div> : null}
    </section>
  );
}

function ReviewFilters({
  search,
  onSearch,
  segment,
  onSegment,
  card,
  onCard,
  cards,
  type,
  onType,
  sort,
  onSort,
  counts,
  onAdd,
}: {
  search: string;
  onSearch: (value: string) => void;
  segment: ReviewSegment;
  onSegment: (value: ReviewSegment) => void;
  card: string;
  onCard: (value: string) => void;
  cards: string[];
  type: string;
  onType: (value: string) => void;
  sort: ReviewSort;
  onSort: (value: ReviewSort) => void;
  counts: Record<ReviewSegment, number>;
  onAdd: () => void;
}) {
  const segments: Array<[ReviewSegment, string]> = [
    ["all", "Todos"],
    ["installments", "Parceladas"],
    ["single", "Avulsas"],
    ["low", "Baixa confiança"],
    ["ignored", "Ignorados"],
  ];
  return (
    <section className="invoice-review-controls" aria-label="Filtros dos lançamentos">
      <div className="invoice-review-search">
        <label htmlFor="invoice-review-search">Buscar lançamento</label>
        <input
          id="invoice-review-search"
          type="search"
          value={search}
          onChange={event => onSearch(event.target.value)}
          placeholder="Descrição ou estabelecimento"
        />
      </div>
      <div className="invoice-review-segments" aria-label="Segmentação">
        {segments.map(([value, label]) => (
          <button
            type="button"
            className={segment === value ? "active" : ""}
            aria-pressed={segment === value}
            onClick={() => onSegment(value)}
            key={value}
          >
            {label} <span>{counts[value]}</span>
          </button>
        ))}
      </div>
      <div className="invoice-review-selects">
        {cards.length > 1 ? (
          <label>
            Cartão
            <select value={card} onChange={event => onCard(event.target.value)}>
              <option value="all">Todos os finais</option>
              {cards.map(lastFour => (
                <option value={lastFour} key={lastFour}>Final {lastFour}</option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Tipo
          <select value={type} onChange={event => onType(event.target.value)}>
            <option value="all">Todos os tipos</option>
            {entryTypes.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Ordenar
          <select
            value={sort}
            onChange={event => onSort(event.target.value as ReviewSort)}
          >
            <option value="original">Ordem da fatura</option>
            <option value="highest">Maior valor</option>
            <option value="lowest">Menor valor</option>
            <option value="confidence">Menor confiança</option>
            <option value="date">Data</option>
          </select>
        </label>
        <button className="invoice-review-add" type="button" onClick={onAdd}>
          Adicionar lançamento
        </button>
      </div>
    </section>
  );
}

function ReviewEditor({
  entry,
  onSave,
  onCancel,
}: {
  entry: ParsedInvoiceEntry;
  onSave: (entry: ParsedInvoiceEntry) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(entry);
  const update = (patch: Partial<ParsedInvoiceEntry>) =>
    setDraft(current => ({ ...current, ...patch }));
  const installment = draft.installment;
  const updateInstallment = (
    field: "current" | "total",
    rawValue: string,
  ) => {
    if (!rawValue) {
      update({ installment: null });
      return;
    }
    const value = Math.max(1, Number(rawValue) || 1);
    const next = {
      current: installment?.current ?? 1,
      total: installment?.total ?? Math.max(2, value),
      raw: installment?.raw ?? "manual",
      confidence: installment?.confidence ?? 1,
      [field]: value,
    };
    if (next.total < next.current) next.total = next.current;
    update({ installment: next });
  };
  const save = () => {
    const hasInstallment = Boolean(draft.installment);
    onSave({
      ...draft,
      descriptionNormalized: draft.descriptionRaw.trim().toUpperCase(),
      entryType:
        hasInstallment && draft.entryType === "purchase"
          ? "installment_purchase"
          : !hasInstallment && draft.entryType === "installment_purchase"
            ? "purchase"
            : draft.entryType,
      reviewStatus: draft.isIgnored ? "ignored" : "edited",
    });
  };

  return (
    <div className="invoice-review-editor" role="region" aria-label={`Editar ${entry.descriptionRaw}`}>
      <div className="invoice-review-editor-grid">
        <label>
          Data
          <input
            type="date"
            value={draft.transactionDate ?? ""}
            onChange={event => update({ transactionDate: event.target.value || null })}
          />
        </label>
        <label className="editor-description">
          Descrição
          <input
            value={draft.descriptionRaw}
            onChange={event => update({ descriptionRaw: event.target.value })}
          />
        </label>
        <label>
          Tipo
          <select
            value={draft.entryType}
            onChange={event => update({ entryType: event.target.value as InvoiceEntryType })}
          >
            {entryTypes.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Valor
          <input
            inputMode="decimal"
            value={(Math.abs(draft.amountCents) / 100).toFixed(2)}
            onChange={event => update({
              amountCents: Math.round(
                (Number(event.target.value.replace(",", ".")) || 0) * 100,
              ),
            })}
          />
        </label>
        <label>
          Parcela atual
          <input
            inputMode="numeric"
            value={installment?.current ?? ""}
            placeholder="—"
            onChange={event => updateInstallment("current", event.target.value)}
          />
        </label>
        <label>
          Total de parcelas
          <input
            inputMode="numeric"
            value={installment?.total ?? ""}
            placeholder="—"
            onChange={event => updateInstallment("total", event.target.value)}
          />
        </label>
        <label>
          Final do cartão
          <input
            inputMode="numeric"
            maxLength={4}
            value={draft.cardLastFour ?? ""}
            placeholder="0000"
            onChange={event => update({
              cardLastFour: event.target.value.replace(/\D/g, "").slice(0, 4) || null,
            })}
          />
        </label>
        <label className="editor-note">
          Observação
          <input
            value={draft.note ?? ""}
            placeholder="Opcional"
            onChange={event => update({ note: event.target.value || null })}
          />
        </label>
        <label className="invoice-review-ignore-check">
          <input
            type="checkbox"
            checked={draft.isIgnored}
            onChange={event => update({ isIgnored: event.target.checked })}
          />
          Ignorar este lançamento
        </label>
      </div>
      <div className="invoice-review-editor-actions">
        <button type="button" onClick={onCancel}>Cancelar edição</button>
        <button
          type="button"
          className="danger"
          onClick={() => onSave({ ...draft, isIgnored: true, reviewStatus: "ignored" })}
        >
          Ignorar lançamento
        </button>
        <button type="button" className="finance-button" onClick={save}>
          Salvar item
        </button>
      </div>
    </div>
  );
}

function ReviewRow({
  entry,
  expanded,
  onToggleIgnored,
  onEdit,
  onSave,
  onCancel,
}: {
  entry: ParsedInvoiceEntry;
  expanded: boolean;
  onToggleIgnored: () => void;
  onEdit: () => void;
  onSave: (entry: ParsedInvoiceEntry) => void;
  onCancel: () => void;
}) {
  return (
    <article
      className={`invoice-review-row ${entry.isIgnored ? "ignored" : ""} ${expanded ? "expanded" : ""}`}
      data-confidence={confidenceLevel(entry.confidence)}
    >
      <div className="invoice-review-row-main">
        <label className="invoice-review-row-toggle">
          <input
            type="checkbox"
            checked={entry.isIgnored}
            onChange={onToggleIgnored}
          />
          <span className="sr-only">Ignorar {entry.descriptionRaw}</span>
        </label>
        <div className="invoice-review-row-description">
          <strong>{entry.descriptionRaw}</strong>
          <small>{entry.merchantNormalized || "Descrição original da fatura"}</small>
        </div>
        <strong className="invoice-review-row-value">
          {formatCents(Math.abs(entry.amountCents))}
        </strong>
        <div className="invoice-review-row-meta">
          <time dateTime={entry.transactionDate ?? undefined}>
            {entry.transactionDate
              ? entry.transactionDate.slice(8, 10) + "/" + entry.transactionDate.slice(5, 7)
              : "—"}
          </time>
          <span className="invoice-review-row-type">{typeLabels[entry.entryType]}</span>
          <span className={entry.installment ? "installment-badge" : "invoice-review-dash"}>
            {entry.installment
              ? `${entry.installment.current}/${entry.installment.total}`
              : entry.entryType === "purchase" ? "Compra" : "—"}
          </span>
          <span className="invoice-review-card-last">
            {entry.cardLastFour ? `•• ${entry.cardLastFour}` : "—"}
          </span>
          <span
            className={`confidence ${confidenceLevel(entry.confidence)}`}
            title={`${Math.round(entry.confidence * 100)}% de confiança`}
          >
            {confidenceLabel(entry.confidence)} · {Math.round(entry.confidence * 100)}%
          </span>
        </div>
        <button
          type="button"
          className="invoice-review-edit"
          aria-expanded={expanded}
          onClick={onEdit}
        >
          {expanded ? "Fechar" : "Editar"}
        </button>
      </div>
      {expanded ? (
        <ReviewEditor
          key={entry.id}
          entry={entry}
          onSave={onSave}
          onCancel={onCancel}
        />
      ) : null}
    </article>
  );
}

function ReviewDetails({
  review,
  updateParsed,
}: {
  review: InvoiceReviewState;
  updateParsed: (patch: Partial<InvoiceReviewState["parsed"]>) => void;
}) {
  const reconciliation = review.reconciliation;
  const warnings = review.parsed.warnings ?? [];
  return (
    <details className="invoice-review-details">
      <summary>
        <span>
          <strong>Dados oficiais e conciliação</strong>
          <small>Datas, total, conferência matemática e avisos da leitura</small>
        </span>
        <span className={reconciliation.status === "matched" ? "positive" : "attention"}>
          {reconciliation.status === "matched"
            ? "Conciliada"
            : reconciliation.status === "unavailable"
              ? "Total pendente"
              : "Revisar diferença"}
        </span>
      </summary>
      <div className="invoice-review-details-body">
        <div className="invoice-review-fields">
          <label>
            Fechamento
            <input
              type="date"
              value={review.parsed.closingDate ?? ""}
              onChange={event => updateParsed({ closingDate: event.target.value || null })}
            />
          </label>
          <label>
            Vencimento
            <input
              type="date"
              required
              value={review.parsed.dueDate ?? ""}
              onChange={event => updateParsed({ dueDate: event.target.value || null })}
            />
          </label>
          <label>
            Início do período
            <input
              type="date"
              value={review.parsed.cycleStartDate ?? ""}
              onChange={event => updateParsed({ cycleStartDate: event.target.value || null })}
            />
          </label>
          <label>
            Fim do período
            <input
              type="date"
              value={review.parsed.cycleEndDate ?? ""}
              onChange={event => updateParsed({ cycleEndDate: event.target.value || null })}
            />
          </label>
          <label>
            Total oficial (R$)
            <input
              inputMode="decimal"
              value={review.parsed.officialTotalCents === null
                ? ""
                : (review.parsed.officialTotalCents / 100).toFixed(2)}
              onChange={event => {
                const value = event.target.value.replace(",", ".");
                updateParsed({
                  officialTotalCents:
                    value === "" ? null : Math.round((Number(value) || 0) * 100),
                });
              }}
            />
          </label>
          <label>
            Moeda
            <select
              value={review.parsed.currencyCode}
              onChange={event => updateParsed({ currencyCode: event.target.value })}
            >
              <option>BRL</option>
            </select>
          </label>
        </div>
        <dl className="invoice-review-reconciliation">
          <div><dt>Total oficial</dt><dd>{reconciliation.officialTotalCents === null ? "Não informado" : formatCents(reconciliation.officialTotalCents)}</dd></div>
          <div><dt>Compras</dt><dd>{formatCents(reconciliation.purchasesCents)}</dd></div>
          <div><dt>Créditos</dt><dd>− {formatCents(reconciliation.creditsCents)}</dd></div>
          <div><dt>Pagamentos</dt><dd>− {formatCents(reconciliation.paymentsCents)}</dd></div>
          <div><dt>Encargos</dt><dd>{formatCents(reconciliation.financeChargesCents)}</dd></div>
          <div><dt>Reconstruído</dt><dd>{formatCents(reconciliation.reconstructedTotalCents)}</dd></div>
          <div><dt>Diferença</dt><dd>{reconciliation.differenceCents === null ? "Não informada" : formatCents(Math.abs(reconciliation.differenceCents))}</dd></div>
        </dl>
        {reconciliation.status === "different" ? (
          <p className="invoice-review-warning" role="alert">
            O total identificado não corresponde ao total oficial. A diferença
            ficará marcada para revisão.
          </p>
        ) : null}
        <div className="invoice-review-warnings">
          <strong>Avisos da leitura · {warnings.length}</strong>
          {warnings.length ? (
            <ul>{warnings.map((warning, index) => (
              <li key={`${index}-${warning}`}>{warning}</li>
            ))}</ul>
          ) : <p>Nenhum aviso crítico foi identificado.</p>}
        </div>
      </div>
    </details>
  );
}

export function InvoiceImportReview({
  review,
  onChange,
  actions,
}: {
  review: InvoiceReviewState;
  onChange: (review: InvoiceReviewState) => void;
  actions?: ReactNode;
}) {
  const entries = useMemo(
    () => review.parsed.entries ?? [],
    [review.parsed.entries],
  );
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState<ReviewSegment>("all");
  const [card, setCard] = useState("all");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<ReviewSort>("original");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const metrics = getInvoiceReviewMetrics(review);

  const updateParsed = (patch: Partial<InvoiceReviewState["parsed"]>) => {
    const parsed = { ...review.parsed, ...patch };
    onChange({
      ...review,
      parsed,
      reconciliation: reconcileInvoice({
        officialTotalCents: parsed.officialTotalCents,
        previousBalanceCents: parsed.previousBalanceCents,
        entries: parsed.entries,
      }),
    });
  };
  const replaceEntry = (nextEntry: ParsedInvoiceEntry) => {
    updateParsed({
      entries: entries.map(entry => entry.id === nextEntry.id ? nextEntry : entry),
    });
    setExpandedId(null);
  };
  const toggleIgnored = (entry: ParsedInvoiceEntry) =>
    replaceEntry({
      ...entry,
      isIgnored: !entry.isIgnored,
      reviewStatus: entry.isIgnored ? "edited" : "ignored",
    });
  const addManualEntry = () => {
    const id = crypto.randomUUID();
    const entry: ParsedInvoiceEntry = {
      id,
      transactionDate: review.parsed.cycleEndDate,
      postingDate: null,
      descriptionRaw: "Lançamento manual",
      descriptionNormalized: "LANCAMENTO MANUAL",
      merchantNormalized: "",
      amountCents: 0,
      currencyCode: "BRL",
      entryType: "unknown",
      cardLastFour: review.parsed.cardLastFour,
      installment: null,
      confidence: 1,
      reviewStatus: "edited",
      isIgnored: false,
      sourceLineNumber: null,
      note: null,
    };
    updateParsed({ entries: [...entries, entry] });
    setSearch("");
    setSegment("all");
    setCard("all");
    setType("all");
    setExpandedId(id);
  };

  const cards = useMemo(
    () => [...new Set(entries.map(entry => entry.cardLastFour).filter(
      (value): value is string => Boolean(value),
    ))].sort(),
    [entries],
  );
  const counts = useMemo<Record<ReviewSegment, number>>(() => ({
    all: entries.length,
    installments: entries.filter(entry => !entry.isIgnored && entry.installment).length,
    single: entries.filter(entry => !entry.isIgnored && !entry.installment).length,
    low: entries.filter(entry => !entry.isIgnored && confidenceLevel(entry.confidence) === "low").length,
    ignored: entries.filter(entry => entry.isIgnored).length,
  }), [entries]);
  const originalOrder = useMemo(
    () => new Map(entries.map((entry, index) => [entry.id, index])),
    [entries],
  );
  const visibleEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
    return entries
      .filter(entry => {
        if (
          normalizedSearch &&
          !`${entry.descriptionRaw} ${entry.merchantNormalized}`
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedSearch)
        ) return false;
        if (card !== "all" && entry.cardLastFour !== card) return false;
        if (type !== "all" && entry.entryType !== type) return false;
        if (segment === "installments") return !entry.isIgnored && Boolean(entry.installment);
        if (segment === "single") return !entry.isIgnored && !entry.installment;
        if (segment === "low") {
          return !entry.isIgnored && confidenceLevel(entry.confidence) === "low";
        }
        if (segment === "ignored") return entry.isIgnored;
        return true;
      })
      .sort((left, right) => {
        if (sort === "highest") return Math.abs(right.amountCents) - Math.abs(left.amountCents);
        if (sort === "lowest") return Math.abs(left.amountCents) - Math.abs(right.amountCents);
        if (sort === "confidence") return left.confidence - right.confidence;
        if (sort === "date") {
          return (left.transactionDate ?? "").localeCompare(right.transactionDate ?? "");
        }
        return (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0);
      });
  }, [entries, search, card, type, segment, sort, originalOrder]);

  const groupedEntries = useMemo(() => {
    if (cards.length <= 1) {
      return [{ key: cards[0] ?? "all", entries: visibleEntries }];
    }
    const groups = new Map<string, ParsedInvoiceEntry[]>();
    for (const entry of visibleEntries) {
      const key = entry.cardLastFour ?? "unknown";
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    return [...groups.entries()].map(([key, groupEntries]) => ({
      key,
      entries: groupEntries,
    }));
  }, [cards, visibleEntries]);

  return (
    <div className="invoice-review">
      <ReviewSummary review={review} metrics={metrics} actions={actions} />
      <ReviewDetails review={review} updateParsed={updateParsed} />
      <ReviewFilters
        search={search}
        onSearch={setSearch}
        segment={segment}
        onSegment={setSegment}
        card={card}
        onCard={setCard}
        cards={cards}
        type={type}
        onType={setType}
        sort={sort}
        onSort={setSort}
        counts={counts}
        onAdd={addManualEntry}
      />
      <section className="invoice-review-list" aria-label="Lançamentos extraídos do PDF">
        <div className="invoice-review-list-head" aria-hidden="true">
          <span />
          <span>Data</span>
          <span>Descrição</span>
          <span>Tipo</span>
          <span>Valor</span>
          <span>Parcela</span>
          <span>Cartão</span>
          <span>Confiança</span>
          <span />
        </div>
        {groupedEntries.map(group => (
          <section className="invoice-review-card-group" key={group.key}>
            {cards.length > 1 ? (
              <header>
                <div>
                  <strong>{group.key === "unknown" ? "Cartão não identificado" : `Cartão final ${group.key}`}</strong>
                  <span>{group.entries.length} lançamentos</span>
                </div>
                <strong>{formatCents(group.entries
                  .filter(entry => !entry.isIgnored)
                  .reduce((sum, entry) => sum + entry.amountCents, 0))}</strong>
              </header>
            ) : null}
            <div>
              {group.entries.map(entry => (
                <ReviewRow
                  key={entry.id}
                  entry={entry}
                  expanded={expandedId === entry.id}
                  onToggleIgnored={() => toggleIgnored(entry)}
                  onEdit={() => setExpandedId(current => current === entry.id ? null : entry.id)}
                  onSave={replaceEntry}
                  onCancel={() => setExpandedId(null)}
                />
              ))}
            </div>
          </section>
        ))}
        {visibleEntries.length === 0 ? (
          <div className="invoice-review-empty">
            <p>{entries.length
              ? "Nenhum lançamento corresponde aos filtros."
              : "Nenhum lançamento foi identificado automaticamente."}</p>
            <span>Ajuste os filtros ou adicione um lançamento manual.</span>
            <button type="button" onClick={addManualEntry}>
              Adicionar lançamento manualmente
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
