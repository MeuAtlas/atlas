import { NextResponse } from "next/server";
import { requireFlightAccess } from "@/modules/flight/access";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase } = await requireFlightAccess();
    const deleted = await supabase.rpc("delete_flight_schedule_snapshot", { p_import_id: id });
    if (deleted.error || !deleted.data) return NextResponse.json({ error: { message: "Não foi possível excluir esta atualização." } }, { status: 422 });
    const result = deleted.data as { storageBucket: string; storagePath: string };
    const storage = await supabase.storage.from(result.storageBucket).remove([result.storagePath]);
    return NextResponse.json({ deleted: true, storageRemoved: !storage.error });
  } catch {
    return NextResponse.json({ error: { message: "Não foi possível excluir esta atualização." } }, { status: 500 });
  }
}
