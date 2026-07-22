"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[Atlas Runtime Error]", {
      context: "aplicação",
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="grid min-h-svh place-items-center bg-[var(--atlas-bg)] p-6 text-[var(--atlas-text)]">
      <section className="w-full max-w-lg rounded-[var(--atlas-radius)] border border-[var(--atlas-border)] bg-[var(--atlas-surface)] p-8 text-center shadow-[var(--atlas-shadow)] backdrop-blur-xl" role="alert">
        <h1 className="text-xl font-semibold">Não foi possível carregar esta área</h1>
        <p className="mt-3 text-sm text-[var(--atlas-muted)]">O Atlas encontrou um problema ao acessar os dados.</p>
        <button type="button" onClick={unstable_retry} className="finance-button mt-6">Tentar novamente</button>
      </section>
    </main>
  );
}
