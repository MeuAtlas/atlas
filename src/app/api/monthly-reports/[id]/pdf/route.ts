import { NextResponse } from "next/server";

import { getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Relatório inválido.", { status: 400 });
  const context = await getReadableFinanceWorkspace();
  const report = await context.supabase.from("monthly_financial_reports").select("pdf_storage_path,workspace_id").eq("id", id).single();
  if (report.error || !report.data?.pdf_storage_path) return new NextResponse("PDF não encontrado.", { status: 404 });
  const membership = await context.supabase.from("workspace_members").select("workspace_id").eq("workspace_id", report.data.workspace_id).eq("user_id", context.user.id).eq("status", "active").maybeSingle();
  if (!membership.data) return new NextResponse("Acesso negado.", { status: 403 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const signed = await context.supabase.storage.from("financial-reports").createSignedUrl(report.data.pdf_storage_path, 60, { download });
  if (signed.error) return new NextResponse("Não foi possível abrir o PDF.", { status: 500 });
  return NextResponse.redirect(signed.data.signedUrl);
}
