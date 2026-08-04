import { redirect } from "next/navigation";
import { InvoiceImportFlow } from "@/components/finance/invoice-import-flow";
import { requireFinanceAccess } from "@/modules/finance/access";
import { invoiceImportCanonicalPath } from "@/modules/finance/invoice-import/api-types";

export default async function ImportInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ document?: string; documentId?: string; statement?: string }>;
}) {
  const query = await searchParams;
  const requestedDocument = query.documentId ?? query.document;
  if (requestedDocument) {
    redirect(invoiceImportCanonicalPath(requestedDocument));
  }
  const { supabase, user } = await requireFinanceAccess();
  const [cardsResult, statementResult] = await Promise.all([
    supabase.from("credit_cards")
      .select("id,name,institution_name,last_four_digits")
      .eq("owner_id", user.id)
      .eq("status", "active")
      .order("name"),
    query.statement
      ? supabase.from("card_invoices")
        .select("id,card_id,reference_month,due_date,provider_invoice_total,pluggy_bill_total_amount,status")
        .eq("id", query.statement)
        .eq("owner_id", user.id)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (cardsResult.error) {
    throw new Error("INVOICE_IMPORT_CARDS_QUERY_FAILED");
  }
  return (
    <InvoiceImportFlow
      cards={cardsResult.data ?? []}
      targetStatement={statementResult.data ?? null}
    />
  );
}
