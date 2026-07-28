"use client";

import { useEffect } from "react";

export default function MovementsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("movements_render_error", {
      digest: error.digest ?? "unknown",
    });
  }, [error.digest]);

  return (
    <section className="finance-panel movement-empty-state" role="alert">
      <h2>Não foi possível carregar as movimentações</h2>
      <p>Seus dados não foram alterados. Tente novamente.</p>
      <button type="button" className="finance-button" onClick={unstable_retry}>
        Tentar novamente
      </button>
    </section>
  );
}
