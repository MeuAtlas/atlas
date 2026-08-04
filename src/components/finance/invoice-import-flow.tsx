"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import {
  getInvoiceReviewMetrics,
  InvoiceImportReview,
} from "./invoice-import-review";
import {
  invoiceImportCanonicalPath,
} from "@/modules/finance/invoice-import/api-types";
import { formatCents } from "@/modules/finance/invoice-import/money";
import {
  getInvoiceImportStepState,
  type InvoiceImportReviewDTO,
  type InvoiceImportStep,
} from "@/modules/finance/invoice-import/review-dto";
import type {
  ExistingInvoiceDocumentResolution,
} from "@/modules/finance/invoice-import/existing-document";
import type {
  InvoiceImportResult,
  InvoiceReviewState,
} from "@/modules/finance/invoice-import/types";

type CardOption = {
  id: string;
  name: string;
  institution_name: string | null;
  last_four_digits: string | null;
};
type TargetStatement = {
  id: string;
  card_id: string;
  reference_month: string;
  due_date: string;
  provider_invoice_total: number | null;
  pluggy_bill_total_amount: number | null;
  status: string;
};
type Phase =
  | "select"
  | "processing"
  | "existing"
  | "review"
  | "inconsistent"
  | "confirming"
  | "result";

export function InvoiceImportFlow({
  cards,
  initialReview = null,
  initialExisting = null,
  initialReviewDTO = null,
  canonicalDocumentId,
  documentNotFound = false,
  targetStatement = null,
}: {
  cards: CardOption[];
  initialReview?: InvoiceReviewState | null;
  initialExisting?: ExistingInvoiceDocumentResolution | null;
  initialReviewDTO?: InvoiceImportReviewDTO | null;
  canonicalDocumentId?: string;
  documentNotFound?: boolean;
  targetStatement?: TargetStatement | null;
}) {
  const router = useRouter();
  const canOpenInitialReview =
    initialReview && initialExisting?.action === "continue_review";
  const [phase, setPhase] = useState<Phase>(
    initialReviewDTO?.inconsistent
      ? "inconsistent"
      : canOpenInitialReview
        ? "review"
        : initialExisting
          ? "existing"
          : "select",
  );
  const [cardId, setCardId] = useState(
    initialReview?.cardId ?? initialExisting?.cardId ?? targetStatement?.card_id ?? cards[0]?.id ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [review, setReview] = useState<InvoiceReviewState | null>(initialReview);
  const [existing, setExisting] =
    useState<ExistingInvoiceDocumentResolution | null>(initialExisting);
  const [result, setResult] = useState<InvoiceImportResult | null>(null);
  const [error, setError] = useState<string | null>(
    documentNotFound ? "A importação solicitada não foi encontrada." : null,
  );
  const [processingLabel, setProcessingLabel] = useState("Enviando documento");
  const replacementInput = useRef<HTMLInputElement>(null);
  const selectedCard = useMemo(
    () => cards.find(card => card.id === cardId),
    [cards, cardId],
  );
  const reviewMetrics = useMemo(
    () => review ? getInvoiceReviewMetrics(review) : null,
    [review],
  );

  function openCanonicalDocument(documentId: string) {
    const path = invoiceImportCanonicalPath(documentId);
    router.replace(path, { scroll: false });
    router.refresh();
  }

  function handleApiResult(body: {
    status?: string;
    documentId?: string;
    nextStep?: string;
  } & Partial<ExistingInvoiceDocumentResolution>) {
    if (body.documentId) {
      openCanonicalDocument(body.documentId);
      return;
    }
    setError("O servidor não informou o identificador da importação.");
    setPhase("select");
  }

  async function processDocument() {
    if (!file || !cardId) {
      setError("Selecione uma fatura em PDF.");
      return;
    }
    setError(null);
    setProcessingLabel("Enviando documento");
    setPhase("processing");
    const data = new FormData();
    data.set("cardId", cardId);
    if (targetStatement) data.set("targetStatementId", targetStatement.id);
    data.set("file", file);
    setProcessingLabel("Extraindo texto do PDF");
    const response = await fetch("/api/invoice-imports", {
      method: "POST",
      body: data,
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível ler este documento.");
      setPhase("select");
      return;
    }
    handleApiResult(body);
  }

  async function retry() {
    if (!existing) return;
    setError(null);
    setProcessingLabel("Extraindo texto do PDF");
    setPhase("processing");
    const response = await fetch(
      `/api/invoice-imports/${existing.documentId}/reprocess`,
      { method: "POST" },
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível reprocessar o documento.");
      setExisting({
        ...existing,
        documentStatus: "failed",
        action: "retry",
        message: "Este documento já foi enviado, mas o processamento falhou.",
        errorCode: body.error?.code ?? existing.errorCode,
        canReplace: true,
        canDelete: true,
      });
      setPhase("existing");
      return;
    }
    if (!body.documentId) {
      setError("O reprocessamento terminou sem identificar o documento.");
      setPhase("existing");
      return;
    }
    openCanonicalDocument(body.documentId);
  }

  async function refreshStatus() {
    if (!existing) return;
    setError(null);
    const response = await fetch(`/api/invoice-imports/${existing.documentId}`);
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível consultar a importação.");
      return;
    }
    const next = body.resolution as ExistingInvoiceDocumentResolution;
    setExisting(next);
    if (next.action === "continue_review") {
      router.push(invoiceImportCanonicalPath(next.documentId), { scroll: false });
    }
  }

  async function startManualReview() {
    if (!existing) return;
    setError(null);
    setProcessingLabel("Preparando revisão manual");
    setPhase("processing");
    const response = await fetch(
      `/api/invoice-imports/${existing.documentId}/manual`,
      { method: "POST" },
    );
    const body = await response.json();
    if (!response.ok || !body.documentId) {
      setError(
        body.error?.message ?? "Não foi possível preparar a revisão manual.",
      );
      setPhase("existing");
      return;
    }
    openCanonicalDocument(body.documentId);
  }

  async function replaceFile(newFile: File | null) {
    if (!existing || !newFile) return;
    setError(null);
    setProcessingLabel("Substituindo e extraindo o documento");
    setPhase("processing");
    const data = new FormData();
    data.set("file", newFile);
    const response = await fetch(
      `/api/invoice-imports/${existing.documentId}/replace`,
      { method: "POST", body: data },
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível substituir o documento.");
      setPhase("existing");
      return;
    }
    handleApiResult(body);
  }

  async function deleteAttempt() {
    if (!existing) return;
    setError(null);
    const response = await fetch(`/api/invoice-imports/${existing.documentId}`, {
      method: "DELETE",
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível excluir esta tentativa.");
      return;
    }
    setExisting(null);
    setReview(null);
    setFile(null);
    setPhase("select");
    setError(body.storageRemoved === false
      ? "A tentativa foi removida, mas o arquivo órfão precisará de limpeza administrativa."
      : null);
    router.replace("/financeiro/cartoes/importar-fatura");
    router.refresh();
  }

  async function confirm() {
    if (!review) return;
    setError(null);
    setPhase("confirming");
    const response = await fetch(
      `/api/invoice-imports/${review.documentId}/confirm`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ review }),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível confirmar a importação.");
      setPhase("review");
      return;
    }
    setResult(body.result);
    setPhase("result");
  }

  async function saveDraft() {
    if (!review) return;
    setError(null);
    const response = await fetch(`/api/invoice-imports/${review.documentId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ review }),
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error?.message ?? "Não foi possível salvar o rascunho.");
      return;
    }
    setError("Rascunho salvo. Você pode atualizar ou reabrir esta URL com segurança.");
    router.refresh();
  }

  if (phase === "result" && result) {
    return (
      <section className="finance-panel invoice-import-result" role="status">
        <span className="invoice-import-success">✓</span>
        <p className="eyebrow">Importação concluída</p>
        <h2>Fatura consolidada</h2>
        <p>
          {result.entriesCreated} lançamentos e {result.occurrencesCreated} ocorrências
          de parcelas foram registrados.
        </p>
        <div>
          <Link className="finance-button" href={`/financeiro/cartoes?view=history&invoice=${result.billId}`}>
            Abrir fatura
          </Link>
          <Link href="/financeiro/planejamento">
            Ver parcelamentos
          </Link>
          <Link href="/financeiro/cartoes">
            Voltar para Cartões
          </Link>
        </div>
      </section>
    );
  }

  const documentStatus =
    phase === "result"
      ? "confirmed"
      : phase === "confirming"
        ? "needs_review"
        : phase === "review" || phase === "inconsistent"
          ? "needs_review"
          : phase === "processing"
            ? "parsing"
            : existing?.documentStatus ?? "uploaded";
  const stepState = getInvoiceImportStepState(documentStatus);
  const steps: Array<[InvoiceImportStep, string]> = [
    ["document", "Documento"],
    ["processing", "Processamento"],
    ["review", "Revisão"],
    ["confirmation", "Confirmação"],
  ];

  return (
    <div className="invoice-import-shell">
      <nav className="invoice-import-steps" aria-label="Progresso da importação">
        {steps.map(
          ([step, label], index) => (
            <span
              key={label}
              className={stepState[step]}
              aria-current={stepState[step] === "current" ? "step" : undefined}
            >
              {stepState[step] === "completed" ? "✓" : index + 1}
              <small>{label}</small>
            </span>
          ),
        )}
      </nav>

      {phase === "select" ? (
        <section className="finance-panel invoice-upload-panel">
          <header>
            <div><p className="eyebrow">Fonte oficial</p><h2>Importar fatura em PDF</h2></div>
          </header>
          {targetStatement ? (
            <p className="invoice-review-warning" role="status">
              Vinculando à fatura de {targetStatement.reference_month.slice(0, 7)},
              com vencimento em {targetStatement.due_date.slice(8, 10)}/{targetStatement.due_date.slice(5, 7)}.
              O PDF será o detalhamento definitivo após a revisão.
            </p>
          ) : null}
          <p>O documento ficará privado e será oficial somente depois da sua revisão.</p>
          <label>
            Cartão
            <select
              value={cardId}
              onChange={event => setCardId(event.target.value)}
              disabled={Boolean(targetStatement)}
            >
              {cards.map(card => (
                <option key={card.id} value={card.id}>
                  {card.name} · {card.last_four_digits ?? "••••"}
                </option>
              ))}
            </select>
          </label>
          <label className="invoice-file-drop">
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={event => {
                const selected = event.target.files?.[0] ?? null;
                if (selected && selected.size > 20 * 1024 * 1024) {
                  setError("O arquivo excede o limite de 20 MB.");
                  setFile(null);
                  return;
                }
                setFile(selected);
                setError(null);
              }}
            />
            <b>{file ? file.name : "Selecione uma fatura em PDF."}</b>
            <small>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${selectedCard?.name}`
                : "PDF com até 20 MB"}
            </small>
          </label>
          {file ? (
            <button className="invoice-remove-file" type="button" onClick={() => setFile(null)}>
              Remover arquivo
            </button>
          ) : null}
          {error ? <p className="invoice-review-warning" role="alert">{error}</p> : null}
          <footer>
            <Link href="/financeiro/cartoes?view=history">Cancelar</Link>
            <button className="finance-button" type="button" onClick={processDocument} disabled={!file || !cardId}>
              Processar documento
            </button>
          </footer>
        </section>
      ) : null}

      {phase === "processing" ? (
        <section className="finance-panel invoice-processing" aria-live="polite">
          <span className="invoice-spinner" />
          <h2>{processingLabel}</h2>
          <p>Identificando a fatura, lendo lançamentos e preparando a revisão.</p>
        </section>
      ) : null}

      {phase === "existing" && existing ? (
        <section className="finance-panel invoice-existing-state" aria-live="polite">
          <p className="eyebrow">Documento já enviado</p>
          <h2>{existing.message}</h2>
          {existing.errorCode ? <small>Etapa anterior: {existing.errorCode}</small> : null}
          {existing.processingAttempts >= 3 ? (
            <p>Você também pode substituir o arquivo; PDFs sem texto podem ser preenchidos manualmente após o processamento.</p>
          ) : null}
          {error ? <p className="invoice-review-warning" role="alert">{error}</p> : null}
          <div className="invoice-existing-actions">
            {existing.action === "open_bill" ? (
              <Link className="finance-button" href={`/financeiro/cartoes?view=history&invoice=${existing.billId ?? ""}`}>
                Abrir fatura
              </Link>
            ) : null}
            {existing.action === "continue_review" ? (
              <button type="button" className="finance-button" onClick={() => {
                if (review) setPhase("review");
                else router.push(
                  invoiceImportCanonicalPath(existing.documentId),
                  { scroll: false },
                );
              }}>
                Continuar revisão
              </button>
            ) : null}
            {existing.action === "retry" || existing.action === "continue_processing" ? (
              <>
                <button type="button" className="finance-button" onClick={retry}>
                  {existing.action === "retry" ? "Tentar novamente" : "Continuar processamento"}
                </button>
                {existing.action === "retry" ? (
                  <button type="button" onClick={startManualReview}>
                    Preencher manualmente
                  </button>
                ) : null}
              </>
            ) : null}
            {existing.action === "wait" ? (
              <button type="button" className="finance-button" onClick={refreshStatus}>
                Atualizar status
              </button>
            ) : null}
            {existing.canReplace ? (
              <>
                <input
                  ref={replacementInput}
                  className="invoice-hidden-file"
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={event => replaceFile(event.target.files?.[0] ?? null)}
                />
                <button type="button" onClick={() => replacementInput.current?.click()}>
                  Substituir arquivo
                </button>
              </>
            ) : null}
            {existing.canDelete ? (
              <button type="button" className="danger" onClick={deleteAttempt}>
                Excluir tentativa
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {phase === "inconsistent" ? (
        <section className="finance-panel invoice-inconsistent-state" role="alert">
          <p className="eyebrow">Revisão incompleta</p>
          <h2>A revisão desta importação não foi preparada corretamente.</h2>
          <p>
            O documento foi preservado, mas o resultado estruturado está ausente
            ou inválido. Reprocesse o PDF para reconstruir a revisão.
          </p>
          {error ? <p className="invoice-review-warning">{error}</p> : null}
          <div className="invoice-existing-actions">
            <button type="button" className="finance-button" onClick={retry}>
              Reprocessar
            </button>
            <button type="button" onClick={startManualReview}>
              Preencher manualmente
            </button>
            <Link href={`/api/invoice-imports/${canonicalDocumentId}/pdf`} target="_blank">
              Diagnosticar PDF
            </Link>
            {existing?.canDelete ? (
              <button type="button" className="danger" onClick={deleteAttempt}>
                Excluir tentativa
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {(phase === "review" || phase === "confirming") && review ? (
        <>
          <InvoiceImportReview
            review={review}
            onChange={setReview}
            actions={(
              <>
                <button type="button" onClick={retry}>Reprocessar</button>
                <button type="button" onClick={() => replacementInput.current?.click()}>
                  Substituir PDF
                </button>
                <Link href="/financeiro/cartoes">Cancelar importação</Link>
              </>
            )}
          />
          <input
            ref={replacementInput}
            className="invoice-hidden-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={event => replaceFile(event.target.files?.[0] ?? null)}
          />
          {error ? <p className="invoice-review-warning sticky-warning" role="alert">{error}</p> : null}
          <footer className="invoice-review-actions">
            <div className="invoice-review-footer-summary">
              <strong>{reviewMetrics?.total ?? 0} lançamentos</strong>
              <span>{reviewMetrics?.installments ?? 0} parcelados</span>
              <span>{reviewMetrics?.ignored ?? 0} ignorados</span>
              <span>
                Total validado: {reviewMetrics?.validatedTotalCents === null
                  ? "não informado"
                  : formatCents(reviewMetrics?.validatedTotalCents ?? 0)}
              </span>
            </div>
            <div className="invoice-review-footer-actions">
              <Link href="/financeiro/cartoes?view=history">Voltar</Link>
              <button type="button" onClick={saveDraft}>
                Salvar rascunho
              </button>
              <button
                type="button"
                className="finance-button"
                disabled={
                  phase === "confirming" ||
                  !review.parsed.dueDate ||
                  review.parsed.officialTotalCents === null
                }
                onClick={confirm}
              >
                {phase === "confirming" ? "Confirmando…" : "Confirmar importação"}
              </button>
            </div>
          </footer>
        </>
      ) : null}

      {phase === "review" && !review ? (
        <section className="finance-panel invoice-inconsistent-state" role="alert">
          <h2>A revisão desta importação não foi preparada corretamente.</h2>
          <p>Nenhum dado revisável foi recebido. Recarregue a rota canônica ou reprocesse o documento.</p>
          <button type="button" className="finance-button" onClick={retry}>
            Reprocessar
          </button>
        </section>
      ) : null}
    </div>
  );
}
