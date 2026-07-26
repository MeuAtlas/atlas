"use client";

import { useFormStatus } from "react-dom";

function StatusButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Atualizando…" : children}</button>;
}

export function CardStatusForm({
  action,
  cardId,
  currentView,
  mode,
}: {
  action: (data: FormData) => Promise<void>;
  cardId: string;
  currentView: "manage" | "archived";
  mode: "archive" | "restore";
}) {
  const restoring = mode === "restore";
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const message = restoring
          ? "Desarquivar este cartão? Todo o histórico e os vínculos existentes serão preservados."
          : "Arquivar este cartão? As compras e faturas serão preservadas.";
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={cardId} />
      <input type="hidden" name="view" value={currentView} />
      <StatusButton>{restoring ? "Desarquivar" : "Arquivar"}</StatusButton>
    </form>
  );
}
