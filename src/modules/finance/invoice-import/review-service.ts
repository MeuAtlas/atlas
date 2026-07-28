import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveExistingInvoiceDocumentAction,
  type InvoiceDocumentStateRow,
} from "./existing-document";
import {
  buildInvoiceImportReviewDTO,
  type InvoiceImportReviewDTO,
} from "./review-dto";
import { InvoiceImportError } from "./repository";

const REVIEW_DOCUMENT_COLUMNS =
  "id,workspace_id,user_id,card_id,bill_id,original_filename,processing_status,review_status,parser_name,parser_version,confidence,parser_warnings,parsed_payload,processing_attempts,processing_started_at,processing_lock_until,processing_error_code,last_processing_error_code,confirmed_at,created_at,updated_at,deleted_at";

export async function getInvoiceImportReview(
  supabase: SupabaseClient,
  userId: string,
  documentId: string,
): Promise<InvoiceImportReviewDTO> {
  const result = await supabase
    .from("invoice_documents")
    .select(REVIEW_DOCUMENT_COLUMNS)
    .eq("id", documentId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (result.error) {
    throw new InvoiceImportError(
      "INVOICE_REVIEW_QUERY_FAILED",
      "Não foi possível carregar os dados desta importação.",
    );
  }
  if (!result.data) {
    throw new InvoiceImportError(
      "DOCUMENT_NOT_FOUND",
      "Importação não encontrada ou sem permissão de acesso.",
    );
  }

  const row = result.data as unknown as InvoiceDocumentStateRow & {
    workspace_id: string;
    user_id: string;
    original_filename: string;
    parser_name: string | null;
    parser_version: string | null;
    confidence: number | string | null;
    parser_warnings: unknown;
    parsed_payload: unknown;
    created_at: string;
    updated_at: string;
  };
  const card = await supabase
    .from("credit_cards")
    .select("id,workspace_id")
    .eq("id", row.card_id)
    .eq("owner_id", userId)
    .maybeSingle();
  if (card.error) {
    throw new InvoiceImportError(
      "INVOICE_REVIEW_CARD_QUERY_FAILED",
      "Não foi possível validar o cartão desta importação.",
    );
  }
  if (
    !card.data ||
    (card.data.workspace_id && card.data.workspace_id !== row.workspace_id)
  ) {
    throw new InvoiceImportError(
      "INVOICE_REVIEW_NOT_AUTHORIZED",
      "Esta importação não pertence ao espaço financeiro atual.",
    );
  }

  return buildInvoiceImportReviewDTO(
    row,
    resolveExistingInvoiceDocumentAction(row),
  );
}
