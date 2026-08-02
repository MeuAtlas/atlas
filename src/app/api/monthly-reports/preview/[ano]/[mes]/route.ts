import { NextResponse } from "next/server";

import { isBeforeFinancialTracking } from "@/modules/finance/monthly-financial-report";
import { generateMonthlyReportPdf } from "@/modules/finance/monthly-financial-report-pdf";
import { getMonthlyReportPreview, getReadableFinanceWorkspace } from "@/modules/finance/monthly-financial-report-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ ano: string; mes: string }> }) {
  const { ano, mes } = await params;
  const year = Number(ano);
  const month = Number(mes);
  if (!Number.isInteger(year) || year < 1900 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) {
    return new NextResponse("Período inválido.", { status: 400 });
  }

  const url = new URL(request.url);
  const context = await getReadableFinanceWorkspace(url.searchParams.get("workspace"), { fallbackToPersonal: true });
  if (isBeforeFinancialTracking({
    year,
    month,
    trackingStartYear: context.tracking.startYear,
    trackingStartMonth: context.tracking.startMonth,
  })) {
    return new NextResponse("Relatório não encontrado.", { status: 404 });
  }

  const data = await getMonthlyReportPreview({
    supabase: context.supabase,
    workspaceId: context.workspaceId,
    year,
    month,
    tracking: context.tracking,
    canCreate: false,
    ownerId: context.user.id,
    includeOwnerPrivateData: context.includeOwnerPrivateData,
  });
  if (data.financialMonth.status !== "awaiting_consolidation") {
    return new NextResponse("A prévia está disponível enquanto o relatório aguarda consolidação.", { status: 409 });
  }

  const generated = await generateMonthlyReportPdf({
    snapshot: data.snapshot,
    version: 1,
    workspaceName: context.workspaceName,
    preview: true,
  });
  const filename = `atlas-previa-${year}-${String(month).padStart(2, "0")}.pdf`;
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";

  return new Response(new Uint8Array(generated.bytes), {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
