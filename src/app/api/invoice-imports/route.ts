import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";
import { processingResponseFromReview } from "@/modules/finance/invoice-import/api-types";
import {
  InvoiceImportError,
  reprocessInvoiceDocument,
  uploadInvoicePdf,
} from "@/modules/finance/invoice-import/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireFinanceAccess();
    const form = await request.formData();
    const file = form.get("file");
    const cardId = form.get("cardId");
    const targetStatementId = form.get("targetStatementId");
    if (!(file instanceof File) || typeof cardId !== "string") {
      return NextResponse.json({ error: { code: "invalid_request", message: "Selecione uma fatura em PDF." } }, { status: 400 });
    }
    const result = await uploadInvoicePdf({
      supabase,
      userId: user.id,
      cardId,
      targetStatementId:
        typeof targetStatementId === "string" && targetStatementId
          ? targetStatementId
          : null,
      file,
    });
    if (["continue_processing", "continue_review", "retry"].includes(result.action)) {
      const review = await reprocessInvoiceDocument({
        supabase,
        userId: user.id,
        documentId: result.documentId,
      });
      return NextResponse.json(processingResponseFromReview(review));
    }
    return NextResponse.json({
      ...result,
      status: result.status === "existing" && result.documentStatus !== "uploaded"
        ? "existing"
        : "uploaded",
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
    if (error instanceof InvoiceImportError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "unexpected_error", message: "Não foi possível processar o documento." } }, { status: 500 });
  }
}
