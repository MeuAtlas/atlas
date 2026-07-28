import { redirect } from "next/navigation";
import { InvoiceImportFlow } from "@/components/finance/invoice-import-flow";
import { requireFinanceAccess } from "@/modules/finance/access";
import { invoiceImportCanonicalPath } from "@/modules/finance/invoice-import/api-types";

export default async function ImportInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ document?: string; documentId?: string }>;
}) {
  const query = await searchParams;
  const requestedDocument = query.documentId ?? query.document;
  if (requestedDocument) {
    redirect(invoiceImportCanonicalPath(requestedDocument));
  }
  const { supabase, user } = await requireFinanceAccess();
  const cardsResult = await supabase.from("credit_cards")
    .select("id,name,institution_name,last_four_digits")
    .eq("owner_id", user.id)
    .eq("status", "active")
    .order("name");
  if (cardsResult.error) {
    throw new Error("INVOICE_IMPORT_CARDS_QUERY_FAILED");
  }
  return (
    <InvoiceImportFlow
      cards={cardsResult.data ?? []}
    />
  );
}
