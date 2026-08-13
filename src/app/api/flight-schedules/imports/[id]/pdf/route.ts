import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { supabase, user } = await requireFlightAccess();
  const result = await supabase.from("flight_schedule_imports").select("storage_bucket,storage_path")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!result.data) return NextResponse.json({ error: { message: "Escala não encontrada." } }, { status: 404 });
  const signed = await supabase.storage.from(String(result.data.storage_bucket)).createSignedUrl(String(result.data.storage_path), 60);
  if (signed.error) return NextResponse.json({ error: { message: "Não foi possível abrir o PDF." } }, { status: 422 });
  return NextResponse.redirect(signed.data.signedUrl);
}
