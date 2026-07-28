import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  deleteFailedInvoiceImport,
  InvoiceImportError,
  saveInvoiceReviewDraft,
} from "@/modules/finance/invoice-import/repository";
import { invoiceReviewSchema } from "@/modules/finance/invoice-import/validation";
import { getInvoiceImportReview } from "@/modules/finance/invoice-import/review-service";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const review = await getInvoiceImportReview(supabase, user.id, id);
    return NextResponse.json({
      resolution: review.resolution,
      document: review.document,
      hasReview: Boolean(review.reviewState),
      inconsistent: review.inconsistent,
    });
  } catch (error) {
    const message = error instanceof InvoiceImportError
      ? error.message
      : "Importação não encontrada.";
    return NextResponse.json(
      { error: { code: "DOCUMENT_NOT_FOUND", message } },
      { status: 404 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const result = await deleteFailedInvoiceImport({
      supabase,
      userId: user.id,
      documentId: id,
    });
    revalidatePath("/financeiro/cartoes");
    revalidatePath("/financeiro/cartoes/importar-fatura");
    return NextResponse.json(result);
  } catch (error) {
    const typed = error instanceof InvoiceImportError
      ? error
      : new InvoiceImportError("DELETE_FAILED", "Não foi possível excluir esta tentativa.");
    return NextResponse.json(
      { error: { code: typed.code, message: typed.message } },
      { status: typed.code === "CONFIRMED_DOCUMENT" ? 409 : 422 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const body: unknown = await request.json();
    const validated = invoiceReviewSchema.safeParse(
      typeof body === "object" && body !== null && "review" in body
        ? (body as { review: unknown }).review
        : null,
    );
    if (!validated.success) {
      return NextResponse.json(
        { error: { code: "INVALID_REVIEW", message: "O rascunho contém dados inválidos." } },
        { status: 400 },
      );
    }
    const result = await saveInvoiceReviewDraft({
      supabase,
      userId: user.id,
      documentId: id,
      review: validated.data,
    });
    revalidatePath(`/financeiro/cartoes/importar-fatura/${id}`);
    return NextResponse.json(result);
  } catch (error) {
    const typed = error instanceof InvoiceImportError
      ? error
      : new InvoiceImportError("DRAFT_SAVE_FAILED", "Não foi possível salvar o rascunho.");
    return NextResponse.json(
      { error: { code: typed.code, message: typed.message } },
      { status: 422 },
    );
  }
}
