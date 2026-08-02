"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { generateMonthlyReportPdf } from "@/modules/finance/monthly-financial-report-pdf";
import {
  getMonthlyPeriod,
  hashMonthlySnapshot,
  validateMonthlyClosing,
} from "@/modules/finance/monthly-financial-report";
import {
  getMonthlyReportPreview,
  getReadableFinanceWorkspace,
} from "@/modules/finance/monthly-financial-report-query";

const uuid = z.string().uuid();
const money = z.preprocess((value) => {
  const text = String(value ?? "").trim();
  return Number(text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text);
}, z.number().finite().nonnegative());

function refresh(year: number, month: number) {
  revalidatePath("/financeiro/relatorios");
  revalidatePath(`/financeiro/relatorios/${year}/${String(month).padStart(2, "0")}`);
}

export async function configureFinancialTrackingStart(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const selectedMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(data.get("tracking_month"));
  const [year, month] = selectedMonth.split("-").map(Number);
  const context = await requireAdmin(workspaceId);
  if (!context.tracking.schemaReady) throw new Error("A migration do início do acompanhamento ainda não foi aplicada.");
  const finalized = await context.supabase.from("financial_months").select("id").eq("workspace_id", workspaceId).eq("status", "closed").limit(1);
  if (finalized.data?.length) throw new Error("Depois do primeiro fechamento, o mês inicial exige uma alteração administrativa específica.");
  const startedAt = getMonthlyPeriod(year, month).startInstant;
  const saved = await context.supabase.rpc("set_financial_tracking_start", { p_user_id: context.user.id, p_started_at: startedAt, p_source: "manual_configuration", p_started_by: context.user.id });
  if (saved.error) throw new Error(saved.error.message);
  revalidatePath("/financeiro/relatorios");
}

async function requireAdmin(workspaceId: string) {
  const context = await getReadableFinanceWorkspace(workspaceId);
  if (!context.canAdmin) throw new Error("Somente o proprietário ou um administrador pode concluir este mês.");
  return context;
}

async function recordAudit(context: Awaited<ReturnType<typeof requireAdmin>>, input: { workspaceId: string; financialMonthId?: string; reportId?: string; action: string; metadata?: Record<string, unknown> }) {
  const financialMonthId = input.financialMonthId;
  if (!financialMonthId) return;
  await context.supabase.from("monthly_report_audit_logs").insert({ workspace_id: input.workspaceId, financial_month_id: financialMonthId, report_id: input.reportId ?? null, action: input.action, performed_by: context.user.id, metadata: input.metadata ?? {} });
}

export async function saveOfficialStatement(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const invoiceId = uuid.parse(data.get("invoice_id"));
  const year = z.coerce.number().int().parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const officialAmount = money.parse(data.get("official_amount"));
  const context = await requireAdmin(workspaceId);
  const invoice = await context.supabase.from("card_invoices").select("id,card_id,calculated_invoice_total,total_amount,credit_cards!inner(workspace_id)").eq("id", invoiceId).single();
  const related = invoice.data?.credit_cards as unknown as { workspace_id?: string } | Array<{ workspace_id?: string }> | null;
  const relatedWorkspace = Array.isArray(related) ? related[0]?.workspace_id : related?.workspace_id;
  if (invoice.error || relatedWorkspace !== workspaceId) throw new Error("Fatura não encontrada neste espaço.");
  const calculated = Number(invoice.data.calculated_invoice_total ?? invoice.data.total_amount ?? 0);
  const difference = Math.round((officialAmount - calculated) * 100) / 100;
  const note = String(data.get("note") ?? "").trim();
  const confirmedWithDifference = String(data.get("confirm_difference") ?? "") === "on";
  if (confirmedWithDifference && Math.abs(difference) >= 0.01 && note.length < 3) throw new Error("Explique brevemente a diferença confirmada.");
  const saved = await context.supabase.from("card_invoices").update({
    official_total_amount: officialAmount,
    official_amount_source: "manual",
    official_amount_confirmed: true,
    calculated_total_amount: calculated,
    reconciliation_difference: difference,
    reconciliation_status: Math.abs(difference) < 0.01 ? "matched" : confirmedWithDifference ? "confirmed_with_difference" : "different",
    reconciliation_note: note || null,
    confirmed_at: new Date().toISOString(),
    confirmed_by: context.user.id,
    closing_date: String(data.get("closing_date")),
    due_date: String(data.get("due_date")),
    statement_period_start: String(data.get("cycle_start")) || null,
    statement_period_end: String(data.get("cycle_end")) || null,
  }).eq("id", invoiceId);
  if (saved.error) throw new Error("Não foi possível salvar o valor oficial da fatura.");
  const monthRow = await context.supabase.from("financial_months").select("id").eq("workspace_id", workspaceId).eq("reference_year", year).eq("reference_month", month).maybeSingle();
  await recordAudit(context, { workspaceId, financialMonthId: monthRow.data?.id, action: "official_statement_saved", metadata: { invoice_id: invoiceId, official_amount: officialAmount, difference } });
  refresh(year, month);
}

export async function assignCardTransactionResponsibility(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const purchaseId = uuid.parse(data.get("purchase_id"));
  const year = z.coerce.number().int().parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const type = z.enum(["own_expense", "third_party_expense", "shared_expense", "business_reimbursable"]).parse(data.get("responsibility_type"));
  const context = await requireAdmin(workspaceId);
  const purchase = await context.supabase.from("card_purchases").select("installment_amount,total_amount").eq("id", purchaseId).eq("workspace_id", workspaceId).single();
  if (purchase.error) throw new Error("Compra não encontrada.");
  const amount = Math.abs(Number(purchase.data.installment_amount ?? purchase.data.total_amount));
  const personal = type === "shared_expense" ? money.parse(data.get("personal_share")) : type === "own_expense" ? amount : 0;
  const thirdParty = Math.round((amount - personal) * 100) / 100;
  if (personal > amount || thirdParty < 0) throw new Error("A divisão informada é maior que o valor da compra.");
  const responsible = String(data.get("financial_responsible_id") ?? "") || null;
  if (type !== "own_expense" && !responsible) throw new Error("Escolha quem pagará esta parte.");
  const saved = await context.supabase.from("card_purchases").update({
    financial_responsible_id: responsible,
    responsibility_type: type,
    personal_share_amount: personal,
    third_party_share_amount: thirdParty,
    responsibility_confirmed: true,
    responsibility_note: String(data.get("note") ?? "").trim() || null,
  }).eq("id", purchaseId).eq("workspace_id", workspaceId);
  if (saved.error) throw new Error("Não foi possível salvar a responsabilidade desta compra.");
  const monthRow = await context.supabase.from("financial_months").select("id").eq("workspace_id", workspaceId).eq("reference_year", year).eq("reference_month", month).maybeSingle();
  await recordAudit(context, { workspaceId, financialMonthId: monthRow.data?.id, action: "responsibility_changed", metadata: { purchase_id: purchaseId, responsibility_type: type, personal_share: personal, third_party_share: thirdParty } });
  refresh(year, month);
}

async function generateAndStorePdf(input: {
  reportId: string;
  workspaceId: string;
  workspaceName: string;
  year: number;
  month: number;
  version: number;
  snapshot: Awaited<ReturnType<typeof getMonthlyReportPreview>>["snapshot"];
  supabase: Awaited<ReturnType<typeof getReadableFinanceWorkspace>>["supabase"];
}) {
  try {
    const generated = await generateMonthlyReportPdf({ snapshot: input.snapshot, version: input.version, workspaceName: input.workspaceName });
    const month = String(input.month).padStart(2, "0");
    const path = `${input.workspaceId}/${input.year}/${month}/relatorio-financeiro-${input.year}-${month}-v${input.version}.pdf`;
    const upload = await input.supabase.storage.from("financial-reports").upload(path, generated.bytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) throw upload.error;
    const finalized = await input.supabase.rpc("finalize_monthly_report_pdf", { p_report_id: input.reportId, p_path: path, p_hash: generated.hash });
    if (finalized.error) throw finalized.error;
  } catch (error) {
    await input.supabase.rpc("mark_monthly_report_pdf_failed", { p_report_id: input.reportId, p_message: error instanceof Error ? error.message : "Falha inesperada" });
    throw new Error("O mês foi salvo, mas não conseguimos gerar o PDF. Você pode tentar novamente sem perder nenhuma informação.");
  }
}

export async function closeFinancialMonth(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const year = z.coerce.number().int().min(1900).max(2200).parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const context = await requireAdmin(workspaceId);
  const preview = await getMonthlyReportPreview({ supabase: context.supabase, workspaceId, year, month, tracking: context.tracking, canCreate: true, ownerId: context.user.id, includeOwnerPrivateData: context.includeOwnerPrivateData });
  if (!preview.schemaReady) throw new Error("A migration do relatório mensal ainda não foi aplicada.");
  const validation = validateMonthlyClosing({ period: preview.snapshot.period, status: preview.financialMonth.status, statements: preview.statements, purchases: preview.purchases, allocations: preview.snapshot.allocations, accountsSyncHealthy: true });
  if (!validation.canClose) throw new Error(validation.blockers[0]?.description ?? "Ainda existem informações para conferir.");
  const hash = hashMonthlySnapshot(preview.snapshot);
  if (preview.snapshot.tracking.availableDataStartAt !== preview.financialMonth.available_data_start_at) {
    const trackingUpdate = await context.supabase.from("financial_months").update({ available_data_start_at: preview.snapshot.tracking.availableDataStartAt }).eq("id", preview.financialMonth.id);
    if (trackingUpdate.error) throw new Error("Não foi possível registrar o início dos dados disponíveis.");
  }
  const closed = await context.supabase.rpc("close_financial_month", { p_month_id: preview.financialMonth.id, p_snapshot: preview.snapshot, p_snapshot_hash: hash, p_totals: preview.snapshot.totals });
  if (closed.error || !closed.data) throw new Error(closed.error?.message ?? "Não foi possível concluir este mês.");
  const report = Array.isArray(closed.data) ? closed.data[0] : closed.data;
  if (report.status === "final" && report.pdf_storage_path) { refresh(year, month); return; }
  await generateAndStorePdf({ reportId: String(report.id), workspaceId, workspaceName: context.workspaceName, year, month, version: Number(report.version), snapshot: preview.snapshot, supabase: context.supabase });
  refresh(year, month);
}

export async function prepareFinancialMonthForReview(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const year = z.coerce.number().int().min(1900).max(2200).parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const context = await requireAdmin(workspaceId);
  const preview = await getMonthlyReportPreview({ supabase: context.supabase, workspaceId, year, month, tracking: context.tracking, canCreate: true, ownerId: context.user.id, includeOwnerPrivateData: context.includeOwnerPrivateData });
  const validation = validateMonthlyClosing({ period: preview.snapshot.period, status: preview.financialMonth.status, statements: preview.statements, purchases: preview.purchases, allocations: preview.snapshot.allocations, accountsSyncHealthy: true });
  if (!validation.canClose) throw new Error(validation.blockers[0]?.description ?? "Ainda existem informações para conferir.");
  const updated = await context.supabase.rpc("prepare_financial_month_for_review", { p_month_id: preview.financialMonth.id });
  if (updated.error) {
    console.error("[prepareFinancialMonthForReview]", { code: updated.error.code, message: updated.error.message, details: updated.error.details, hint: updated.error.hint });
    throw new Error(updated.error.message || "Não foi possível preparar este mês para revisão.");
  }
  refresh(year, month);
}

export async function retryMonthlyReportPdf(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const reportId = uuid.parse(data.get("report_id"));
  const year = z.coerce.number().int().parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const context = await requireAdmin(workspaceId);
  const report = await context.supabase.from("monthly_financial_reports").select("id,version,status,snapshot_json").eq("id", reportId).eq("workspace_id", workspaceId).single();
  if (report.error || report.data.status !== "generation_failed") throw new Error("Este relatório não está aguardando uma nova tentativa.");
  await generateAndStorePdf({ reportId, workspaceId, workspaceName: context.workspaceName, year, month, version: Number(report.data.version), snapshot: report.data.snapshot_json, supabase: context.supabase });
  refresh(year, month);
}

export async function reopenFinancialMonth(data: FormData) {
  const workspaceId = uuid.parse(data.get("workspace_id"));
  const monthId = uuid.parse(data.get("month_id"));
  const year = z.coerce.number().int().parse(data.get("year"));
  const month = z.coerce.number().int().min(1).max(12).parse(data.get("month"));
  const reason = z.string().trim().min(3).max(1000).parse(data.get("reason"));
  const context = await requireAdmin(workspaceId);
  const result = await context.supabase.rpc("reopen_financial_month", { p_month_id: monthId, p_reason: reason });
  if (result.error) throw new Error(result.error.message);
  refresh(year, month);
}
