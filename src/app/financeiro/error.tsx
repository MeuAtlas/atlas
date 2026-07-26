"use client";

import { useEffect } from "react";

type FinanceRuntimeError = Error & { digest?: string };

export default function FinanceError({
  error,
  unstable_retry,
}: {
  error: FinanceRuntimeError;
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[Atlas Runtime Error]", {
      context: "financeiro",
      name: error.name || "Error",
      message: error.message || "Erro sem mensagem disponível.",
      digest: error.digest ?? null,
      ...(process.env.NODE_ENV === "development"
        ? { stack: error.stack ?? null }
        : {}),
    });
  }, [error]);

  return (
    <section className="finance-panel finance-empty" role="alert">
      <h2>Não foi possível carregar o Financeiro</h2>
      <p>
        O Atlas encontrou um problema ao acessar seus dados. Nenhuma informação
        foi alterada.
      </p>
      <button
        type="button"
        className="finance-button"
        onClick={unstable_retry}
      >
        Tentar novamente
      </button>
    </section>
  );
}
