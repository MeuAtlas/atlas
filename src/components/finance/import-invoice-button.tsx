import Link from "next/link";

export function ImportInvoiceButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link className={compact ? "invoice-import-link compact" : "invoice-import-link"}
      href="/financeiro/cartoes/importar-fatura">
      Importar fatura em PDF
    </Link>
  );
}
