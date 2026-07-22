"use client";

import { useEffect } from "react";

export default function FinanceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[Atlas Runtime Error]", {
      context: "financeiro",
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <section className="finance-panel finance-empty" role="alert">
      <h2>Não foi possível carregar o Financeiro</h2>
      <p>O Atlas encontrou um problema ao acessar seus dados. Nenhuma informação foi alterada.</p>
      <button type="button" className="finance-button" onClick={unstable_retry}>Tentar novamente</button>
    </section>
  );
}
