import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

import type { MonthlyReportSnapshot } from "./monthly-financial-report";

const pt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthName = (year: number, month: number) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

export async function generateMonthlyReportPdf(input: {
  snapshot: MonthlyReportSnapshot;
  version: number;
  workspaceName: string;
  preview?: boolean;
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const safeText = (text: string, font: PDFFont) => Array.from(text).map((character) => {
    const replacement = ({ "—": "-", "–": "-", "…": "...", "“": '"', "”": '"', "‘": "'", "’": "'" } as Record<string, string>)[character] ?? character;
    try {
      font.encodeText(replacement);
      return replacement;
    } catch {
      return "?";
    }
  }).join("");
  const navy = rgb(0.08, 0.13, 0.23);
  const muted = rgb(0.38, 0.43, 0.52);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 770;
  const line = (text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    if (y < 70) { page = pdf.addPage([595.28, 841.89]); y = 780; }
    const selectedFont = options.font ?? regular;
    page.drawText(safeText(text, selectedFont), { x: 54, y, size: options.size ?? 10, font: selectedFont, color: options.color ?? navy });
    y -= options.gap ?? (options.size ?? 10) + 8;
  };
  const section = (title: string) => { y -= 12; line(title, { size: 15, font: bold, gap: 26 }); };
  const value = (label: string, amount: number) => line(`${label}: ${pt.format(amount)}`, { size: 11, gap: 19 });

  line("ATLAS", { size: 12, font: bold, color: muted, gap: 34 });
  line("Relatório financeiro mensal", { size: 25, font: bold, gap: 35 });
  line(monthName(input.snapshot.period.year, input.snapshot.period.month), { size: 19, font: bold, gap: 30 });
  line(input.workspaceName, { size: 11, color: muted });
  line(input.preview
    ? `Prévia dinâmica • atualizada em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: input.snapshot.period.timeZone }).format(new Date(input.snapshot.generatedAt))}`
    : `Versão ${input.version} • concluído em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: input.snapshot.period.timeZone }).format(new Date(input.snapshot.generatedAt))}`, { size: 10, color: muted });
  if (input.snapshot.tracking.isFirstFinancialReport) {
    line(input.snapshot.tracking.isPartialInitialMonth
      ? `Primeiro mês acompanhado pelo Atlas. Dados disponíveis desde ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: input.snapshot.period.timeZone }).format(new Date(input.snapshot.tracking.availableDataStartAt))}.`
      : "Primeiro mês acompanhado pelo Atlas.", { size: 9, color: muted, gap: 22 });
  }
  section("Resumo do mês");
  value("Saldo inicial", input.snapshot.totals.openingBalance);
  value("Entradas", input.snapshot.totals.totalIncome);
  value("Saídas bancárias", input.snapshot.totals.totalBankOutflows);
  value("Resultado em caixa", input.snapshot.totals.cashResult);
  value("Saldo final", input.snapshot.totals.closingBalance);
  value("Consumo pessoal", input.snapshot.totals.personalConsumption);

  if (input.snapshot.narrative?.length) {
    section("Leitura do Atlas");
    for (const message of input.snapshot.narrative) line(message, { size: 10, color: muted, gap: 19 });
  }

  if (input.snapshot.incomePerspective) {
    section("Renda em perspectiva");
    value("Receitas reais do mês", input.snapshot.incomePerspective.current);
    if (input.snapshot.incomePerspective.reference != null) value(input.snapshot.incomePerspective.referenceLabel, input.snapshot.incomePerspective.reference);
    line(input.snapshot.incomePerspective.message, { size: 9, color: muted, gap: 20 });
  }

  if (input.snapshot.cardPerspective) {
    section("Cartão em perspectiva");
    value("Fatura do cartão no mês", input.snapshot.cardPerspective.current);
    if (input.snapshot.cardPerspective.reference != null) value(input.snapshot.cardPerspective.referenceLabel, input.snapshot.cardPerspective.reference);
    line(input.snapshot.cardPerspective.message, { size: 9, color: muted, gap: 20 });
  }

  section("Contas");
  for (const account of input.snapshot.accounts) value(account.name, account.closingBalance);

  section("Cartões e valores de terceiros");
  value("Consumo no cartão durante o mês", input.snapshot.totals.totalCardConsumption);
  value("Despesas de outras pessoas", input.snapshot.totals.thirdPartyCardConsumption);
  value("Reembolsos recebidos", input.snapshot.totals.reimbursementsReceived);
  value("Ainda a receber", input.snapshot.totals.reimbursementsPending);
  for (const statement of input.snapshot.statements) {
    line(`${statement.card_name}: oficial ${statement.official_total_amount == null ? "não informado" : pt.format(statement.official_total_amount)} • Atlas ${pt.format(statement.calculated_total_amount)}`, { size: 9, color: muted, gap: 17 });
  }
  y -= 10;
  line("O consumo do mês considera somente compras realizadas dentro do mês-calendário. O valor da fatura pode ser diferente porque o ciclo do cartão atravessa dois meses.", { size: 9, color: muted, gap: 24 });

  if (input.snapshot.consumptionCategories?.length) {
    section("Principais categorias de consumo");
    for (const category of input.snapshot.consumptionCategories.slice(0, 10)) {
      line(`${category.name}: ${pt.format(category.amount)} (${category.share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`, { size: 9, color: muted, gap: 17 });
    }
  }

  if (input.snapshot.futureCommitments?.length) {
    section("Compromissos futuros");
    for (const commitment of input.snapshot.futureCommitments) value(commitment.month, commitment.amount);
  }

  if (input.snapshot.loans?.length) {
    section("Dívidas e empréstimos");
    for (const loan of input.snapshot.loans) {
      line(`${loan.name}: saldo ${pt.format(loan.outstandingBalance)} • parcela ${pt.format(loan.installmentAmount)}`, { size: 9, color: muted, gap: 17 });
    }
  }

  section("Observações");
  const visibleIssues = input.preview
    ? input.snapshot.issues
    : input.snapshot.issues.filter((issue) => issue.severity !== "blocking");
  if (!visibleIssues.length) line("Nenhuma observação relevante ficou pendente.", { color: muted });
  for (const issue of visibleIssues) line(`• ${issue.title}${issue.amount ? ` (${pt.format(issue.amount)})` : ""}`, { size: 9, color: muted, gap: 17 });

  section("Movimentações");
  for (const entry of input.snapshot.entries.slice(0, 120)) {
    line(`${entry.date}  ${entry.description.slice(0, 55)}  ${pt.format(entry.kind === "revenue" ? entry.amount : -entry.amount)}`, { size: 8, color: muted, gap: 14 });
  }
  if (input.snapshot.entries.length > 120) line(`Mais ${input.snapshot.entries.length - 120} movimentações permanecem disponíveis no Atlas.`, { size: 8, color: muted });

  for (const currentPage of pdf.getPages()) {
    currentPage.drawText(safeText(input.preview
      ? "Atlas • prévia em atualização - não é o fechamento oficial"
      : "Atlas • fotografia financeira imutável", regular), { x: 54, y: 30, size: 7, font: regular, color: muted });
  }
  const bytes = await pdf.save();
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}
