import "server-only";

import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { MonthlyReportSnapshot } from "./monthly-financial-report";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const monthName = (year: number, month: number) => new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));

export async function generateMonthlyReportPdf(input: { snapshot: MonthlyReportSnapshot; version: number; workspaceName: string; preview?: boolean }) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = {
    navy: rgb(.07, .13, .24), blue: rgb(.22, .43, .82), lightBlue: rgb(.53, .72, .93), violet: rgb(.43, .34, .78),
    green: rgb(.19, .55, .39), red: rgb(.72, .25, .3), muted: rgb(.38, .44, .53), border: rgb(.85, .88, .92), soft: rgb(.96, .97, .99), white: rgb(1, 1, 1),
  };
  const safe = (value: string, font: PDFFont = regular) => Array.from(value.replace(/[–—]/g, "-")).map((character) => { try { font.encodeText(character); return character; } catch { return "?"; } }).join("");
  const text = (page: PDFPage, value: string, x: number, y: number, size = 8.7, font = regular, color = colors.navy) => page.drawText(safe(value, font), { x, y, size, font, color });
  const right = (page: PDFPage, value: string, x: number, y: number, size = 8.7, font = regular, color = colors.navy) => text(page, value, x - font.widthOfTextAtSize(safe(value, font), size), y, size, font, color);
  const wrap = (value: string, font: PDFFont, size: number, width: number) => {
    const words = safe(value, font).split(/\s+/); const lines: string[] = []; let line = "";
    for (const word of words) { const next = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(next, size) <= width) line = next; else { if (line) lines.push(line); line = word; } }
    if (line) lines.push(line); return lines;
  };
  const paragraph = (page: PDFPage, value: string, x: number, y: number, width: number, size = 8.7, color = colors.muted, leading = 12) => { for (const line of wrap(value, regular, size, width)) { text(page, line, x, y, size, regular, color); y -= leading; } return y; };
  const pageBase = (title: string, subtitle: string) => {
    const page = pdf.addPage([595.28, 841.89]);
    text(page, "ATLAS", 44, 799, 8, bold, colors.blue); text(page, title, 44, 770, 20.5, bold); text(page, subtitle, 44, 750, 8.5, regular, colors.muted);
    page.drawLine({ start: { x: 44, y: 735 }, end: { x: 551, y: 735 }, thickness: .7, color: colors.border });
    return page;
  };
  const section = (page: PDFPage, title: string, y: number) => { text(page, title, 44, y, 12.5, bold); return y - 18; };
  const row = (page: PDFPage, label: string, value: string, y: number, x = 44, width = 507) => { text(page, label, x, y, 7.2, regular, colors.muted); right(page, value, x + width, y, 7.2, bold); page.drawLine({ start: { x, y: y - 5 }, end: { x: x + width, y: y - 5 }, thickness: .35, color: colors.border }); return y - 17; };

  // 1. Como terminou o mês
  let page = pageBase("Relatório financeiro do mês", monthName(input.snapshot.period.year, input.snapshot.period.month));
  text(page, "Uma visão simples do que entrou, do que saiu e de como você terminou o mês.", 44, 718, 9, regular, colors.muted);
  const generatedLabel = input.preview ? `Prévia até ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: input.snapshot.period.timeZone }).format(new Date(input.snapshot.generatedAt))}` : `Concluído em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: input.snapshot.period.timeZone }).format(new Date(input.snapshot.generatedAt))}  •  Versão ${input.version}`;
  right(page, generatedLabel, 551, 718, 7, regular, colors.muted);
  const cards = [["Começou com", input.snapshot.totals.openingBalance, "saldo inicial"], ["Entrou", input.snapshot.totals.totalIncome, "movimento bancário"], ["Saiu", input.snapshot.totals.totalBankOutflows, "movimento bancário"], ["Diferença do mês", input.snapshot.totals.cashResult, "entradas menos saídas"], ["Terminou com", input.snapshot.totals.closingBalance, "saldo no fechamento"], ["Renda do mês", input.snapshot.totals.totalRealIncome ?? input.snapshot.totals.totalIncome, "receitas reais"]] as const;
  cards.forEach(([label, value, helper], index) => { const col = index % 3; const line = Math.floor(index / 3); const x = 44 + col * 173; const y = 683 - line * 76; page.drawRectangle({ x, y: y - 58, width: 160, height: 64, borderWidth: .6, borderColor: colors.border, color: colors.white }); text(page, label, x + 9, y - 9, 6.8, regular, colors.muted); text(page, money.format(value), x + 9, y - 28, 10, bold, value < 0 ? colors.red : colors.navy); text(page, helper, x + 9, y - 44, 6.2, regular, colors.muted); });
  let y = section(page, "Leitura do Atlas", 536); for (const message of input.snapshot.narrative ?? []) y = paragraph(page, message, 44, y, 507, 8.7, colors.muted, 12) - 3;
  y = section(page, "Saldo ao longo do mês", Math.min(y - 4, 458));
  const chart = { x: 54, y: 164, width: 486, height: 245 }; page.drawRectangle({ ...chart, color: colors.white });
  for (let index = 0; index < 5; index++) { const gy = chart.y + index * chart.height / 4; page.drawLine({ start: { x: chart.x, y: gy }, end: { x: chart.x + chart.width, y: gy }, thickness: .35, color: colors.border }); }
  const series = input.snapshot.cashFlow ?? []; const points = series.map((point) => ({ ...point, balance: input.snapshot.totals.openingBalance + point.cumulativeInflow - point.cumulativeOutflow }));
  const values = points.flatMap((point) => [point.balance, point.cumulativeInflow, point.cumulativeOutflow]).concat([0]); const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(1, max - min);
  const drawSeries = (key: "balance" | "cumulativeInflow" | "cumulativeOutflow", color: ReturnType<typeof rgb>, thickness: number) => points.forEach((point, index) => { if (!index) return; const previous = points[index - 1]; const px = chart.x + (index - 1) * chart.width / Math.max(1, points.length - 1); const cx = chart.x + index * chart.width / Math.max(1, points.length - 1); const py = chart.y + (Number(previous[key]) - min) / span * chart.height; const cy = chart.y + (Number(point[key]) - min) / span * chart.height; page.drawLine({ start: { x: px, y: py }, end: { x: cx, y: cy }, thickness, color }); });
  drawSeries("balance", colors.violet, 1.8); drawSeries("cumulativeInflow", colors.blue, 1.1); drawSeries("cumulativeOutflow", colors.lightBlue, 1.1);
  text(page, `Início  ${money.format(input.snapshot.totals.openingBalance)}`, 54, 142, 6.7, bold, colors.violet); right(page, `Fechamento  ${money.format(input.snapshot.totals.closingBalance)}`, 540, 142, 6.7, bold, colors.violet);
  text(page, "Saldo ao longo do mês", 54, 122, 6.5, bold, colors.violet); text(page, "Entradas acumuladas", 190, 122, 6.5, bold, colors.blue); text(page, "Saídas acumuladas", 326, 122, 6.5, bold, colors.lightBlue);
  paragraph(page, "A linha violeta mostra o caminho do seu saldo. A azul mostra as entradas acumuladas e a azul clara mostra as saídas acumuladas.", 54, 102, 486, 6.7, colors.muted, 9);

  // 2. Renda e custo da vida
  page = pageBase("Renda e custo da vida", "Quanto você recebeu, o que já estava comprometido e para onde foi o dinheiro."); y = 708;
  const ensureLifeSpace = (height: number) => { if (y - height < 52) { page = pageBase("Renda e custo da vida - continuação", "A mesma leitura, sem reduzir ou apertar o conteúdo."); y = 704; } };
  const perspective = input.snapshot.incomePerspective; const income = input.snapshot.totals.totalRealIncome ?? 0;
  y = section(page, "Comparação da renda", y); y = row(page, "Você recebeu", money.format(income), y); y = row(page, perspective?.referenceLabel ?? "Seu padrão recente", perspective?.reference == null ? "Ainda sem histórico" : money.format(perspective.reference), y); y = row(page, "Recebeu a mais ou a menos", perspective?.absoluteDifference == null ? "-" : money.format(perspective.absoluteDifference), y); y = row(page, "Diferença percentual", perspective?.percentageDifference == null ? "-" : `${perspective.percentageDifference > 0 ? "+" : ""}${perspective.percentageDifference}%`, y);
  if (!perspective?.monthsUsed) y = paragraph(page, "Este é o primeiro mês acompanhado pelo Atlas. A comparação aparecerá conforme novos meses forem concluídos.", 44, y - 2, 507, 8, colors.muted, 11) - 5;
  ensureLifeSpace(36); y = section(page, "Composição da renda", y); for (const item of input.snapshot.incomeBreakdown ?? []) { ensureLifeSpace(20); y = row(page, item.name, money.format(item.amount), y); }
  ensureLifeSpace(55); y = section(page, "O que já estava comprometido", y); y = paragraph(page, `${money.format(input.snapshot.recurringCommitments?.total ?? 0)} já estavam comprometidos antes do mês começar.${input.snapshot.recurringCommitments?.incomeShare == null ? "" : ` Isso representa ${input.snapshot.recurringCommitments.incomeShare}% da renda real.`}`, 44, y, 507, 8.5, colors.muted, 12) - 5;
  for (const item of input.snapshot.recurringCommitments?.items ?? []) { ensureLifeSpace(20); y = row(page, `${item.group} - ${item.name}`, money.format(item.amount), y); }
  ensureLifeSpace(58); y = section(page, "Casa e dependentes", y); y = row(page, "Custo da casa", money.format(input.snapshot.householdCost?.total ?? 0), y); for (const person of input.snapshot.dependentsCost?.people ?? []) { ensureLifeSpace(20); y = row(page, person.name, money.format(person.total), y); }
  const available = income - (input.snapshot.recurringCommitments?.total ?? 0) - (input.snapshot.householdCost?.total ?? 0) - (input.snapshot.dependentsCost?.total ?? 0); ensureLifeSpace(62); page.drawRectangle({ x: 44, y: y - 55, width: 507, height: 55, color: colors.soft, borderWidth: .5, borderColor: colors.border }); text(page, "Disponível antes dos gastos variáveis", 56, y - 21, 7.2, regular, colors.muted); text(page, money.format(available), 56, y - 43, 12.5, bold, available < 0 ? colors.red : colors.blue); y -= 62;

  // 3. Cartão pago e próxima fatura
  page = pageBase("Cartão pago e próxima fatura", "O caixa usa pagamentos reais; as compras explicam o consumo sem duplicar a saída."); y = 708;
  const ensureCardSpace = (height: number) => { if (y - height < 52) { page = pageBase("Cartão, parcelamentos e futuro - continuação", "Conteúdo mantido em tamanho legível e com a mesma hierarquia."); y = 704; return true; } return false; };
  const paidStatements = input.snapshot.paidStatements ?? input.snapshot.statements ?? [];
  const openStatements = input.snapshot.openStatements ?? [];
  y = section(page, "Cartão pago no mês", y);
  if (!paidStatements.length) y = paragraph(page, "Nenhuma fatura foi paga neste mês.", 44, y, 507, 8.5, colors.muted, 12) - 4;
  for (const statement of paidStatements) {
    ensureCardSpace(105);
    y = row(page, `${statement.card_name} - valor efetivamente pago`, money.format(statement.confirmed_payment_amount ?? statement.official_total_amount ?? 0), y);
    y = row(page, "Data do pagamento", statement.payments?.map(payment => payment.paymentDate.split("-").reverse().join("/")).join(", ") || "Confirmação manual", y);
    y = row(page, "Sua parte / terceiros", `${money.format(statement.personal_share_amount ?? 0)} / ${money.format(statement.third_party_share_amount ?? 0)}`, y);
    y = row(page, "Status da conciliação", statement.payment_confirmation_status ?? "legado", y);
    y = paragraph(page, statement.payment_confirmation_source === "manual_confirmation" ? "Valor confirmado manualmente." : "Valor da fatura confirmado pelo pagamento identificado na conta corrente.", 44, y - 1, 507, 7.8, colors.muted, 10) - 4;
    if (statement.statement_file_path) y = paragraph(page, "Fatura anexada para detalhamento.", 44, y, 507, 7.5, colors.muted, 10) - 3;
  }
  ensureCardSpace(70); y = section(page, "Próxima fatura", y);
  if (!openStatements.length) y = paragraph(page, "Nenhuma fatura aberta foi localizada para o próximo mês.", 44, y, 507, 8.5, colors.muted, 12) - 4;
  for (const statement of openStatements) {
    ensureCardSpace(88);
    y = row(page, `${statement.card_name} - valor atual`, money.format(statement.current_open_amount ?? statement.expected_statement_amount ?? 0), y);
    y = row(page, "Sua parte estimada / terceiros", `${money.format(statement.personal_share_amount ?? 0)} / ${money.format(statement.third_party_share_amount ?? 0)}`, y);
    y = row(page, "Fechamento / vencimento", `${statement.closing_date.split("-").reverse().join("/")} / ${statement.due_date.split("-").reverse().join("/")}`, y);
    y = paragraph(page, "Esta fatura ainda pode mudar. Ela não é uma saída deste mês e compromete a renda do próximo mês.", 44, y - 1, 507, 7.8, colors.muted, 10) - 4;
  }
  ensureCardSpace(52); y = section(page, "Custo pessoal do cartão", y); y = row(page, "Pagamento bruto", money.format(input.snapshot.cashCardOutflow ?? 0), y); y = row(page, "Reembolsos recebidos", money.format(input.snapshot.totals.reimbursementsReceived), y); y = row(page, "Custo líquido pessoal", money.format(input.snapshot.netPersonalCardCost ?? input.snapshot.cashCardOutflow ?? 0), y);
  ensureCardSpace(34); y = section(page, "Valores de terceiros", y); for (const person of input.snapshot.thirdPartySummary ?? []) { ensureCardSpace(20); y = row(page, person.personName, `${money.format(person.total)}  |  recebido ${money.format(person.received)}  |  falta ${money.format(person.pending)}`, y); }
  ensureCardSpace(92); y = section(page, "Parcelamentos", y); y = row(page, "Parcelas cobradas agora", money.format(input.snapshot.installments?.chargedNow ?? 0), y); y = row(page, "Quanto já foi pago", money.format(input.snapshot.installments?.paid ?? 0), y); y = row(page, "Quanto ainda falta pagar", money.format(input.snapshot.installments?.remaining ?? 0), y);
  text(page, "Compra", 44, y, 7, bold, colors.muted); text(page, "Parcela", 270, y, 7, bold, colors.muted); right(page, "Valor / já pago / falta", 551, y, 7, bold, colors.muted); y -= 15;
  for (const item of input.snapshot.installments?.items ?? []) { if (ensureCardSpace(33)) { text(page, "Compra", 44, y, 7, bold, colors.muted); text(page, "Parcela", 270, y, 7, bold, colors.muted); right(page, "Valor / já pago / falta", 551, y, 7, bold, colors.muted); y -= 15; } text(page, item.description.slice(0, 38), 44, y, 7.1); text(page, `${item.current} de ${item.total}`, 270, y, 7.1); right(page, `${money.format(item.amount)} / ${money.format(item.paid)} / ${money.format(item.remaining)}`, 551, y, 7.1); y -= 15; }

  // Próximo mês permanece junto de cartão e parcelamentos quando há espaço.
  const previewIssues = input.preview ? input.snapshot.issues : input.snapshot.issues.filter((issue) => issue.severity !== "blocking");
  const attention = [...new Set([...previewIssues.map((issue) => issue.title), ...(input.snapshot.attention ?? [])])].slice(0, 5);
  const projection = input.snapshot.projection ?? [];
  const requiredHeight = 72 + projection.length * 52 + 68 + attention.length * 18 + 38;
  if (y - requiredHeight < 52) {
    page = pageBase("Próximo mês e pontos de atenção", "O próximo mês começa tranquilo ou apertado?");
    y = 704;
  } else {
    y -= 18;
    y = section(page, "Próximo mês e pontos de atenção", y);
  }
  for (const item of projection) { page.drawRectangle({ x: 44, y: y - 43, width: 507, height: 45, borderWidth: .6, borderColor: colors.border, color: colors.soft }); text(page, monthName(Number(item.month.slice(0, 4)), Number(item.month.slice(5, 7))), 56, y - 17, 9, bold); right(page, money.format(item.total), 539, y - 17, 10.5, bold, colors.blue); text(page, `Cartão ${money.format(item.card ?? 0)}  •  recorrentes ${money.format(item.recurring)}  •  outros ${money.format(item.other)}`, 56, y - 34, 6.8, regular, colors.muted); y -= 52; }
  y = section(page, "Indicadores da virada", y - 3); const next = projection[0]?.total ?? 0; y = row(page, "Saldo final do mês", money.format(input.snapshot.totals.closingBalance), y); y = row(page, "Já previsto para o próximo mês", money.format(next), y); y = row(page, "Falta para cobrir o próximo mês", money.format(Math.max(0, next - input.snapshot.totals.closingBalance)), y); y = row(page, "Ainda receberá de terceiros", money.format(input.snapshot.totals.reimbursementsPending), y);
  y = section(page, "Pontos para ficar de olho", y - 3); for (const warning of attention) { text(page, "•", 47, y, 8, bold, colors.red); y = paragraph(page, warning, 60, y, 480, 8.2, colors.muted, 11) - 3; }
  const pressure = next > input.snapshot.totals.closingBalance; paragraph(page, pressure ? "O mês fechou, mas a virada já começa pressionada. Se parte dos valores de terceiros entrar logo, essa pressão diminui." : "O saldo final cobre os compromissos já conhecidos do próximo mês. Continue acompanhando novas despesas e entradas.", 44, y - 2, 507, 8.5, colors.navy, 12);

  // Anexo bancário separado, com páginas adicionais somente quando necessário.
  const appendixPage = (continued = false) => { page = pageBase(continued ? "Anexo bancário - continuação" : "Anexo - movimento da conta corrente", "Somente movimentações bancárias do mês. Compras do cartão não são repetidas aqui."); y = 704; text(page, "Data", 44, y, 7.1, bold, colors.muted); text(page, "O que aconteceu", 92, y, 7.1, bold, colors.muted); text(page, "Entrou ou saiu", 430, y, 7.1, bold, colors.muted); right(page, "Valor", 551, y, 7.1, bold, colors.muted); y -= 16; };
  appendixPage();
  const bankEntries = input.snapshot.bankMovements?.length
    ? input.snapshot.bankMovements.map(entry => ({ ...entry, kind: entry.direction === "inflow" ? "revenue" : "expense" }))
    : input.snapshot.entries.filter((entry) => entry.sourceKind !== "card" && entry.source === "transaction");
  for (const entry of bankEntries) { if (y < 82) appendixPage(true); text(page, entry.date.slice(8, 10) + "/" + entry.date.slice(5, 7), 44, y, 6.8); text(page, entry.description.slice(0, 62), 92, y, 6.8); text(page, entry.kind === "revenue" ? "Entrou" : "Saiu", 430, y, 6.8, regular, entry.kind === "revenue" ? colors.green : colors.red); right(page, money.format(entry.amount), 551, y, 6.8); page.drawLine({ start: { x: 44, y: y - 4 }, end: { x: 551, y: y - 4 }, thickness: .25, color: colors.border }); y -= 13; }
  page.drawRectangle({ x: 44, y: 42, width: 507, height: 27, color: colors.soft }); text(page, `Entrou na conta ${money.format(input.snapshot.totals.totalIncome)}`, 54, 52, 6.6, bold, colors.green); text(page, `Saiu da conta ${money.format(input.snapshot.totals.totalBankOutflows)}`, 232, 52, 6.6, bold, colors.red); right(page, `Diferença ${money.format(input.snapshot.totals.cashResult)}`, 541, 52, 6.6, bold, colors.navy);

  const pages = pdf.getPages();
  for (const [index, currentPage] of pages.entries()) { text(currentPage, input.preview ? "Prévia dinâmica em atualização - não é o fechamento oficial" : "Fotografia financeira imutável", 44, 28, 6.4, regular, colors.muted); right(currentPage, `${index + 1}/${pages.length}`, 551, 28, 6.4, regular, colors.muted); }
  const bytes = await pdf.save();
  return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
}
