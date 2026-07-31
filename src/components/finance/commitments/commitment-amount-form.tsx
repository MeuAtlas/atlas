"use client";

import { useState } from "react";
import { updateCommitmentAmount } from "@/modules/finance/commitments-actions";
import type {
  CommitmentListItem,
} from "@/modules/finance/commitments-query";
import type { CommitmentOccurrence } from "@/modules/finance/commitments";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";

const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(`${value}T12:00:00Z`),
      )
    : "próxima ocorrência";

export function CommitmentAmountForm({
  workspaceId,
  item,
  occurrence,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  item: CommitmentListItem;
  occurrence: CommitmentOccurrence;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (data: FormData) => {
    setPending(true);
    setMessage("");
    const result = await updateCommitmentAmount(data);
    setPending(false);
    if (!result.ok) {
      setMessage(
        result.fieldErrors.expected_amount?.[0] ??
          result.message,
      );
      return;
    }
    onSaved(result.message);
  };

  return (
    <form action={submit}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input
        type="hidden"
        name="commitment_id"
        value={item.commitment.id}
      />
      <input type="hidden" name="occurrence_id" value={occurrence.id} />
      <AtlasModalHeader>
        <div>
          <p className="eyebrow">Reajuste com histórico</p>
          <h2>Alterar valor previsto</h2>
          <p className="atlas-modal-subtitle">
            O que já foi pago não será modificado.
          </p>
        </div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody className="commitment-amount-body">
        <div className="commitment-amount-context">
          <span>{item.commitment.title}</span>
          <strong>{date(occurrence.expectedDueDate)}</strong>
        </div>
        <label>
          Novo valor
          <div className="money-input">
            <span>R$</span>
            <input
              name="expected_amount"
              inputMode="decimal"
              required
              defaultValue={
                ((occurrence.expectedAmountCents ??
                  item.commitment.expectedAmountCents ??
                  0) / 100)
                  .toFixed(2)
                  .replace(".", ",")
              }
            />
          </div>
        </label>
        <label>
          Comportamento do valor
          <select
            name="amount_type"
            defaultValue={item.commitment.amountType}
          >
            <option value="estimated">Estimado — pode variar</option>
            <option value="fixed">Fixo — normalmente não muda</option>
            <option value="variable">Variável — informado a cada mês</option>
          </select>
        </label>
        <fieldset>
          <legend>Onde aplicar?</legend>
          <label>
            <input
              type="radio"
              name="scope"
              value="single_occurrence"
            />
            <span>
              <b>Somente esta ocorrência</b>
              <small>Altera apenas a previsão selecionada.</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              value="from_effective_date"
              defaultChecked
            />
            <span>
              <b>Desta ocorrência em diante</b>
              <small>O próximo mês já usará o novo valor.</small>
            </span>
          </label>
        </fieldset>
        <label>
          Motivo do reajuste <small>(opcional)</small>
          <input
            name="reason"
            maxLength={240}
            placeholder="Ex.: reajuste anual"
          />
        </label>
        {message ? (
          <p className="atlas-form-error" role="alert">{message}</p>
        ) : null}
      </AtlasModalBody>
      <AtlasModalFooter>
        <button
          type="button"
          className="finance-button secondary"
          disabled={pending}
          onClick={onClose}
        >
          Cancelar
        </button>
        <button type="submit" className="finance-button" disabled={pending}>
          {pending ? "Salvando…" : "Salvar novo valor"}
        </button>
      </AtlasModalFooter>
    </form>
  );
}
