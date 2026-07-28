import { InvoiceImportFlow } from "@/components/finance/invoice-import-flow";
import { requireFinanceAccess } from "@/modules/finance/access";
import { getInvoiceImportReview } from "@/modules/finance/invoice-import/review-service";

export default async function ExistingInvoiceImportPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const { supabase, user } = await requireFinanceAccess();
  const [cardsResult, review] = await Promise.all([
    supabase
      .from("credit_cards")
      .select("id,name,institution_name,last_four_digits")
      .eq("owner_id", user.id)
      .eq("status", "active")
      .order("name"),
    getInvoiceImportReview(supabase, user.id, documentId),
  ]);
  if (cardsResult.error) {
    throw new Error("INVOICE_IMPORT_CARDS_QUERY_FAILED");
  }

  return (
    <InvoiceImportFlow
      cards={cardsResult.data ?? []}
      canonicalDocumentId={documentId}
      initialReview={review.reviewState}
      initialExisting={review.resolution}
      initialReviewDTO={review}
    />
  );
}
