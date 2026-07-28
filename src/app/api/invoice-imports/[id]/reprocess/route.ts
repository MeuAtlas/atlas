import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import { processingResponseFromReview } from "@/modules/finance/invoice-import/api-types";
import {
  InvoiceImportError,
  reprocessInvoiceDocument,
} from "@/modules/finance/invoice-import/repository";

export const runtime = "nodejs";

function responseStatus(error: InvoiceImportError) {
  if (error.status) return error.status;
  if (["DOCUMENT_NOT_FOUND", "STORAGE_FILE_MISSING"].includes(error.code)) return 404;
  if (["PROCESSING_IN_PROGRESS", "PROCESSING_LOCK_FAILED"].includes(error.code)) return 409;
  if (["INVALID_PDF", "PDF_TOO_LARGE"].includes(error.code)) return 400;
  if (
    ["PASSWORD_PROTECTED", "IMAGE_ONLY_PDF", "EMPTY_EXTRACTED_TEXT", "PARSER_FAILED"]
      .includes(error.code)
  ) return 422;
  if (error.code === "STORAGE_DOWNLOAD_FAILED") return 503;
  return 500;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireFinanceAccess();
    const review = await reprocessInvoiceDocument({
      supabase,
      userId: user.id,
      documentId: id,
    });
    revalidatePath("/financeiro/cartoes/importar-fatura");
    revalidatePath(`/financeiro/cartoes/importar-fatura/${id}`);
    revalidatePath("/financeiro/cartoes");
    return NextResponse.json(processingResponseFromReview(review));
  } catch (error) {
    const typed =
      error instanceof InvoiceImportError
        ? error
        : new InvoiceImportError(
            "REPROCESS_FAILED",
            "Não foi possível reprocessar o documento.",
            { cause: error, status: 500 },
          );
    return NextResponse.json(
      {
        status: "failed",
        error: {
          code: typed.code,
          message: typed.message,
          publicMessage: typed.message,
          recoveryActions:
            typed.code === "STORAGE_FILE_MISSING"
              ? ["replace"]
              : typed.code === "IMAGE_ONLY_PDF"
                ? ["manual", "replace"]
                : ["retry", "replace"],
        },
      },
      { status: responseStatus(typed) },
    );
  }
}
