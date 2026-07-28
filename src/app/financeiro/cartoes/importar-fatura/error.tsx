"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function InvoiceImportErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("invoice_import_render_error", {
      digest: error.digest ?? "unknown",
    });
  }, [error.digest]);

  return (
    <section className="finance-panel invoice-import-route-error" role="alert">
      <p className="eyebrow">Importação preservada</p>
      <h2>Não foi possível abrir esta importação</h2>
      <p>Seus dados não foram apagados. Tente carregar novamente ou volte para Cartões.</p>
      <div>
        <button type="button" className="finance-button" onClick={reset}>
          Tentar novamente
        </button>
        <button type="button" onClick={() => window.location.reload()}>
          Reprocessar documento
        </button>
        <Link href="/financeiro/cartoes">Voltar para Cartões</Link>
      </div>
    </section>
  );
}
