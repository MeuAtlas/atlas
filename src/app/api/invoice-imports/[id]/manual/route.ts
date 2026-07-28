import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import { processingResponseFromReview } from "@/modules/finance/invoice-import/api-types";
import {
  InvoiceImportError,
  prepareManualInvoiceReview,
} from "@/modules/finance/invoice-import/repository";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const review = await prepareManualInvoiceReview({
      supabase,
      userId: user.id,
      documentId: id,
    });
    revalidatePath(`/financeiro/cartoes/importar-fatura/${id}`);
    return NextResponse.json(processingResponseFromReview(review));
  } catch (error) {
    const typed = error instanceof InvoiceImportError
      ? error
      : new InvoiceImportError(
          "MANUAL_REVIEW_FAILED",
          "Não foi possível preparar a revisão manual.",
        );
    return NextResponse.json(
      { error: { code: typed.code, message: typed.message } },
      { status: 422 },
    );
  }
}
