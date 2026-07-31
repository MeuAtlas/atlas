"use client";

import { useState } from "react";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";

export type ConfirmActionConfig = {
  title: string;
  description: string;
  confirmLabel: string;
  action: (data: FormData) => Promise<void>;
  fields: Record<string, string>;
};

export function ConfirmAction({
  config,
  onCancel,
  onSuccess,
}: {
  config: ConfirmActionConfig;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (data: FormData) => {
    setPending(true);
    setError("");
    try {
      await config.action(data);
      onSuccess();
    } catch {
      setError("Não foi possível concluir esta ação. Tente novamente.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form action={submit}>
      {Object.entries(config.fields).map(([name, value]) =>
        <input key={name} type="hidden" name={name} value={value} />
      )}
      <AtlasModalHeader>
        <div><p className="eyebrow">Confirmar ação</p><h2>{config.title}</h2></div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody>
        <p className="atlas-confirm-copy">{config.description}</p>
        {error ? <p className="atlas-form-error" role="alert">{error}</p> : null}
      </AtlasModalBody>
      <AtlasModalFooter>
        <button type="button" className="finance-button secondary" disabled={pending} onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="finance-button danger-button" disabled={pending}>
          {pending ? "Processando…" : config.confirmLabel}
        </button>
      </AtlasModalFooter>
    </form>
  );
}
