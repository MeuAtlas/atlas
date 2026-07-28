import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import { confirmInvoiceImport, InvoiceImportError } from "@/modules/finance/invoice-import/repository";
import { invalidateOpenInvoiceCache } from "@/modules/finance/open-invoice-cache";
import type { InvoiceReviewState } from "@/modules/finance/invoice-import/types";
import { invoiceReviewSchema } from "@/modules/finance/invoice-import/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const body: unknown = await request.json();
    const validated = invoiceReviewSchema.safeParse(
      typeof body === "object" && body !== null && "review" in body
        ? (body as { review: unknown }).review : null,
    );
    if (!validated.success) return NextResponse.json({ error: { code: "invalid_review", message: "Revise os dados antes de confirmar." } }, { status: 400 });
    const result = await confirmInvoiceImport({ supabase, userId: user.id, documentId: id, review: validated.data as InvoiceReviewState });
    const openInvoices = await supabase
      .from("card_invoices")
      .select("id,workspace_id")
      .eq("owner_id", user.id)
      .eq("status", "open");
    if (!openInvoices.error) {
      invalidateOpenInvoiceCache(
        (openInvoices.data ?? []).map(invoice => ({
          cycleId: invoice.id,
          workspaceId: invoice.workspace_id,
        })),
      );
    }
    [
      "/financeiro",
      "/financeiro/cartoes",
      "/financeiro/cartoes/importar-fatura",
      "/financeiro/movimentacoes",
      "/financeiro/planejamento",
    ].forEach(path => revalidatePath(path));
    return NextResponse.json({ result });
  } catch (error) {
    const typed = error instanceof InvoiceImportError ? error : new InvoiceImportError("confirmation_failed", "Não foi possível confirmar a importação.");
    return NextResponse.json({ error: { code: typed.code, message: typed.message } }, { status: 422 });
  }
}
