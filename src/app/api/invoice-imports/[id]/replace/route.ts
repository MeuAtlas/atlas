import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  InvoiceImportError,
  replaceInvoiceDocumentFile,
} from "@/modules/finance/invoice-import/repository";
import { processingResponseFromReview } from "@/modules/finance/invoice-import/api-types";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: { code: "INVALID_PDF", message: "Selecione uma fatura em PDF." } },
        { status: 400 },
      );
    }
    const result = await replaceInvoiceDocumentFile({
      supabase,
      userId: user.id,
      documentId: id,
      file,
    });
    revalidatePath("/financeiro/cartoes/importar-fatura");
    revalidatePath(`/financeiro/cartoes/importar-fatura/${id}`);
    return NextResponse.json(result.status === "processed"
      ? processingResponseFromReview(result.review)
      : {
          ...result,
          nextStep:
            result.action === "continue_review"
              ? "review"
              : result.action === "open_bill"
                ? "confirmed"
                : result.action === "retry"
                  ? "retry"
                  : "processing",
        });
  } catch (error) {
    const typed = error instanceof InvoiceImportError
      ? error
      : new InvoiceImportError("REPLACE_FAILED", "Não foi possível substituir o documento.");
    return NextResponse.json(
      { error: { code: typed.code, message: typed.message } },
      { status: 422 },
    );
  }
}
