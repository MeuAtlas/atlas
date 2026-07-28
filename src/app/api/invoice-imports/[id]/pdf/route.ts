import { NextResponse } from "next/server";
import { requireFinanceAccess } from "@/modules/finance/access";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await requireFinanceAccess();
  const result = await supabase.from("invoice_documents")
    .select("storage_bucket,storage_path").eq("id", id).eq("user_id", user.id)
    .is("deleted_at", null).maybeSingle();
  if (!result.data) return NextResponse.json({ error: { code: "document_not_found", message: "Documento não encontrado." } }, { status: 404 });
  const signed = await supabase.storage.from(String(result.data.storage_bucket))
    .createSignedUrl(String(result.data.storage_path), 60);
  if (signed.error) return NextResponse.json({ error: { code: "signed_url_failed", message: "Não foi possível abrir o PDF." } }, { status: 422 });
  return NextResponse.redirect(signed.data.signedUrl);
}
