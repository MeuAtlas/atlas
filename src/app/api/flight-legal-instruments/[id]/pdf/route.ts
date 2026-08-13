import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase } = await requireFlightAccess();
  const result = await supabase.from("flight_legal_instruments").select("storage_bucket,storage_path").eq("id", id).maybeSingle();
  if (!result.data?.storage_bucket || !result.data.storage_path) return NextResponse.json({ error: { message: "Documento jurídico não encontrado." } }, { status: 404 });
  const signed = await supabase.storage.from(result.data.storage_bucket).createSignedUrl(result.data.storage_path, 60);
  if (signed.error) return NextResponse.json({ error: { message: "Não foi possível abrir o PDF." } }, { status: 422 });
  return NextResponse.redirect(signed.data.signedUrl);
}
