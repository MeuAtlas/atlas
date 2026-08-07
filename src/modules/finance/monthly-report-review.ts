import type { FinancialMonthRecord, MonthlyReportRecord } from "./monthly-financial-report-query";
import type {
  MonthlyCardPurchase,
  MonthlyReportSnapshot,
  MonthlyStatement,
} from "./monthly-financial-report";

export type MonthlyReportReviewStatus =
  | "planned"
  | "open"
  | "review"
  | "needs_attention"
  | "closed"
  | "reopened"
  | "closing";

export type MonthlyPaymentCandidate = {
  id: string;
  description: string;
  amount: number;
  paymentDate: string;
  creditCardId: string | null;
  confidence: "high" | "medium" | "low";
};

export type MonthlyReviewBlockingIssue = {
  id: string;
  type: string;
  title: string;
  description: string;
  actionLabel: string;
  statement?: MonthlyStatement;
  candidate?: MonthlyPaymentCandidate;
  amount?: number;
};

export type MonthlyReviewWarning = {
  id: string;
  title: string;
  description: string;
  status: "warning" | "optional" | "info";
};

export type MonthlyReportReviewViewModel = ReturnType<typeof buildMonthlyReportReviewViewModel>;

const money = (value: number) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalize = (value: string | null | undefined) => (value ?? "")
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR");
const isUncategorized = (value: string | null | undefined) =>
  !value || /sem categoria|nao classificado/.test(normalize(value));
const monthLabel = (year: number, month: number) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", year: "numeric", timeZone: "UTC",
}).format(new Date(Date.UTC(year, month - 1, 1)));
const shortMonthLabel = (year: number, month: number) => new Intl.DateTimeFormat("pt-BR", {
  month: "long", timeZone: "UTC",
}).format(new Date(Date.UTC(year, month - 1, 1)));
const dateLabel = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC",
}).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function deriveMonthlyReportStatus(input: {
  persistedStatus: string;
  periodStart: string;
  periodEndExclusive: string;
  blockerCount: number;
  now?: Date;
}): MonthlyReportReviewStatus {
  if (input.persistedStatus === "closed") return "closed";
  if (input.persistedStatus === "closing") return "closing";
  if (input.persistedStatus === "reopened") return "reopened";
  const now = input.now ?? new Date();
  if (now < new Date(input.periodStart)) return "planned";
  if (now < new Date(input.periodEndExclusive)) return "open";
  return input.blockerCount ? "needs_attention" : "review";
}

function candidateForStatement(statement: MonthlyStatement, candidates: MonthlyPaymentCandidate[]) {
  return [...candidates].sort((left, right) => {
    const leftCard = left.creditCardId === statement.card_id ? 1 : 0;
    const rightCard = right.creditCardId === statement.card_id ? 1 : 0;
    const leftDistance = Math.abs(left.amount - statement.expected_statement_amount);
    const rightDistance = Math.abs(right.amount - statement.expected_statement_amount);
    return rightCard - leftCard || leftDistance - rightDistance;
  })[0];
}

function buildBlockers(input: {
  snapshot: MonthlyReportSnapshot;
  reconciliationStatements: MonthlyStatement[];
  paymentCandidates: MonthlyPaymentCandidate[];
}) {
  return input.snapshot.issues.filter(issue => issue.severity === "blocking").map(issue => {
    if (issue.type === "unmatched_card_payment") {
      const statement = input.reconciliationStatements[0];
      const candidate = statement
        ? candidateForStatement(statement, input.paymentCandidates)
        : input.paymentCandidates[0];
      return {
        id: issue.key,
        type: issue.type,
        title: "Pagamento da fatura",
        description: "Encontramos um débito de cartão neste mês e precisamos confirmar a qual fatura ele pertence.",
        actionLabel: "Confirmar vínculo",
        statement,
        candidate,
        amount: candidate?.amount ?? statement?.expected_statement_amount,
      } satisfies MonthlyReviewBlockingIssue;
    }
    return {
      id: issue.key,
      type: issue.type,
      title: issue.title,
      description: issue.description,
      actionLabel: issue.type === "unassigned_card_purchase" ? "Revisar compra" : "Resolver pendência",
      amount: issue.amount,
    } satisfies MonthlyReviewBlockingIssue;
  });
}

function movementDescription(snapshot: MonthlyReportSnapshot, direction: "inflow" | "outflow", amount: number) {
  return snapshot.bankMovements?.find(movement =>
    movement.direction === direction && Math.abs(movement.amount - amount) < 0.01)?.description ?? null;
}

function buildNarrative(input: {
  snapshot: MonthlyReportSnapshot;
  blockers: MonthlyReviewBlockingIssue[];
  firstMonth: boolean;
}) {
  const snapshot = input.snapshot;
  const result = snapshot.totals.cashResult;
  const messages: string[] = [];
  const month = shortMonthLabel(snapshot.period.year, snapshot.period.month);
  messages.push(result < 0
    ? `Em ${month}, saiu ${currency.format(Math.abs(result))} a mais do que entrou. Mesmo assim, você terminou o mês com ${currency.format(snapshot.totals.closingBalance)} na conta.`
    : result > 0
      ? `Em ${month}, entrou ${currency.format(result)} a mais do que saiu, e o saldo final foi de ${currency.format(snapshot.totals.closingBalance)}.`
      : `Em ${month}, entradas e saídas ficaram equilibradas e o saldo final foi de ${currency.format(snapshot.totals.closingBalance)}.`);
  const income = snapshot.incomePerspective;
  if (!input.firstMonth && income?.reference != null && income.absoluteDifference != null) {
    messages.push(`Sua renda real foi de ${currency.format(income.current)}, ${Math.abs(income.percentageDifference ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${income.absoluteDifference < 0 ? "abaixo" : "acima"} da referência recente.`);
  }
  if (input.firstMonth) messages.push("Este é o primeiro mês acompanhado pelo Atlas. A comparação aparecerá após os próximos fechamentos.");
  if (input.blockers.length) messages.push(input.blockers.length === 1
    ? "O pagamento da fatura ainda precisa ser confirmado antes da conclusão."
    : `${input.blockers.length} pendências ainda precisam ser resolvidas antes da conclusão.`);
  if (snapshot.totals.personalConsumption < snapshot.totals.totalBankOutflows) {
    messages.push("Parte das saídas bancárias não representa consumo do mês, como transferências, investimentos e pagamento de fatura.");
  }
  return messages.slice(0, 4);
}

export function buildMonthlyReportReviewViewModel(input: {
  financialMonth: FinancialMonthRecord;
  snapshot: MonthlyReportSnapshot;
  statements: MonthlyStatement[];
  reconciliationStatements: MonthlyStatement[];
  openStatements: MonthlyStatement[];
  paymentCandidates: MonthlyPaymentCandidate[];
  purchases: MonthlyCardPurchase[];
  versions: MonthlyReportRecord[];
  now?: Date;
}) {
  const blockers = buildBlockers(input);
  const status = deriveMonthlyReportStatus({
    persistedStatus: input.financialMonth.status,
    periodStart: input.snapshot.period.startInstant,
    periodEndExclusive: input.snapshot.period.endExclusiveInstant,
    blockerCount: blockers.length,
    now: input.now,
  });
  const statusLabels: Record<MonthlyReportReviewStatus, string> = {
    planned: "Planejado", open: "Em andamento", review: "Pronto para revisão",
    needs_attention: "Precisa de atenção", closed: "Concluído",
    reopened: "Reaberto para correção", closing: "Concluindo mês",
  };
  const realIncome = input.snapshot.totals.totalRealIncome ?? input.snapshot.totals.totalIncome;
  const uncategorizedEntries = input.snapshot.entries.filter(entry =>
    ["expense", "expense_refund"].includes(entry.kind) && isUncategorized(entry.category));
  const categories = (input.snapshot.consumptionCategories ?? []).filter(item => !isUncategorized(item.name));
  const incomeItems = (input.snapshot.incomeBreakdown ?? []).filter(item => !isUncategorized(item.name));
  const incomeNeedsClassification = realIncome > 0 && !incomeItems.length;
  const consumptionNeedsClassification = input.snapshot.totals.personalConsumption > 0 && !categories.length;
  const household = input.snapshot.householdCost?.total ?? 0;
  const dependents = input.snapshot.dependentsCost?.total ?? 0;
  const totalCommitted = input.snapshot.recurringCommitments?.total ?? 0;
  const ownRecurring = money(Math.max(0, totalCommitted - household - dependents));
  const householdUnclassified = household === 0 && uncategorizedEntries.length > 0;
  const available = money(realIncome - totalCommitted);
  const incomeReference = input.snapshot.tracking.isFirstFinancialReport
    ? null
    : input.snapshot.incomePerspective?.reference ?? null;
  const latestSync = input.snapshot.accounts.map(account => account.lastSyncAt)
    .filter((value): value is string => Boolean(value)).sort().at(-1) ?? input.snapshot.generatedAt;
  const warnings: MonthlyReviewWarning[] = input.snapshot.issues
    .filter(issue => issue.severity !== "blocking" && issue.type !== "open_statement_forecast")
    .map(issue => ({
      id: issue.key, title: issue.title, description: issue.description,
      status: issue.type === "statement_pdf_optional" ? "optional" : "warning",
    }));
  if (consumptionNeedsClassification) warnings.push({
    id: "categories", title: "Categorias pendentes",
    description: `${uncategorizedEntries.length} movimentações precisam de categoria para explicar para onde foi o dinheiro.`,
    status: "warning",
  });
  if (householdUnclassified) warnings.push({
    id: "household", title: "Custos da casa não classificados",
    description: "Nenhuma despesa da casa foi classificada neste mês.", status: "warning",
  });
  if (input.snapshot.tracking.isFirstFinancialReport) warnings.push({
    id: "first-comparison", title: "Primeira comparação",
    description: "A referência histórica aparecerá após os próximos fechamentos.", status: "info",
  });
  const nextIncomeBase = incomeReference && incomeReference > 0 ? incomeReference : realIncome > 0 ? realIncome : null;
  const openStatements = input.openStatements.map(statement => ({
    ...statement,
    incomeCommitmentPercentage: nextIncomeBase
      ? Math.round((statement.personal_share_amount / nextIncomeBase) * 1000) / 10
      : null,
    incomeEstimated: incomeReference == null,
  }));
  const paidStatements = input.statements.map(statement => ({
    ...statement,
    state: statement.payment_confirmation_status === "partially_paid" ? "partial" as const
      : ["paid", "manually_confirmed"].includes(statement.payment_confirmation_status) ? "confirmed" as const
        : "difference" as const,
    netPersonalCost: money(Math.max(0,
      statement.confirmed_payment_amount - input.snapshot.totals.reimbursementsReceived)),
  }));
  const detectedStatements = input.reconciliationStatements.map(statement => ({
    statement,
    candidate: candidateForStatement(statement, input.paymentCandidates),
    state: input.paymentCandidates.length ? "detected" as const : "missing" as const,
  }));
  const future = (input.snapshot.projection ?? []).map(item => ({
    month: item.month,
    total: money((item.card ?? 0) + item.recurring + item.other),
    card: money(item.card ?? 0), recurring: money(item.recurring), other: money(item.other),
  }));
  const ownCount = input.purchases.filter(purchase => purchase.responsibility_type === "own_expense").length;
  const unresolvedPurchases = input.purchases.filter(purchase =>
    !purchase.responsibility_confirmed || purchase.responsibility_type === "uncertain");
  const assignedCounts = new Map<string, number>();
  for (const purchase of input.purchases) {
    if (purchase.responsibility_type === "own_expense" || !purchase.financial_responsible_id) continue;
    assignedCounts.set(purchase.financial_responsible_id,
      (assignedCounts.get(purchase.financial_responsible_id) ?? 0) + 1);
  }
  const firstFuture = future[0];
  const finalReview = [
    { label: "Pagamento da fatura", value: blockers.some(item => item.type === "unmatched_card_payment") ? "Pendente" : paidStatements.length ? "Confirmado" : "Sem pagamento identificado", tone: blockers.some(item => item.type === "unmatched_card_payment") ? "warning" : "success" },
    { label: "Responsáveis das compras", value: unresolvedPurchases.length ? `${unresolvedPurchases.length} pendentes` : "Confirmados", tone: unresolvedPurchases.length ? "warning" : "success" },
    { label: "Reembolsos", value: input.snapshot.totals.reimbursementsPending ? "Há valores a receber" : "Conferidos", tone: input.snapshot.totals.reimbursementsPending ? "neutral" : "success" },
    { label: "Movimentações bancárias", value: "Atualizadas", tone: "success" },
    { label: "Categorias", value: consumptionNeedsClassification ? `${uncategorizedEntries.length} pendentes · não bloqueia` : "Revisadas", tone: consumptionNeedsClassification ? "neutral" : "success" },
    { label: "PDF da fatura", value: [...input.statements, ...input.reconciliationStatements].some(statement => statement.statement_file_path || statement.pdf_document_id) ? "Anexado" : "Não anexado · opcional", tone: "neutral" },
    { label: "Snapshot", value: blockers.length ? "Aguardando pendências" : "Pronto", tone: blockers.length ? "warning" : "success" },
  ];
  return {
    header: {
      monthLabel: monthLabel(input.snapshot.period.year, input.snapshot.period.month),
      shortMonthLabel: shortMonthLabel(input.snapshot.period.year, input.snapshot.period.month),
      periodLabel: `${dateLabel(input.snapshot.period.startDate)} a ${dateLabel(new Date(new Date(input.snapshot.period.endExclusiveInstant).getTime() - 1).toISOString())}`,
      status, statusLabel: statusLabels[status], lastUpdatedAt: latestSync,
    },
    notice: blockers.length
      ? `Confira os dados abaixo e resolva ${blockers.length} ${blockers.length === 1 ? "pendência" : "pendências"} antes de concluir ${shortMonthLabel(input.snapshot.period.year, input.snapshot.period.month)}.`
      : `${shortMonthLabel(input.snapshot.period.year, input.snapshot.period.month)} está pronto para sua revisão final.`,
    firstMonth: input.snapshot.tracking.isFirstFinancialReport,
    blockingIssues: blockers,
    warnings,
    summary: [
      { key: "opening", label: "Começou com", value: input.snapshot.totals.openingBalance, helper: "saldo inicial", tone: "neutral" },
      { key: "inflow", label: "Entrou", value: input.snapshot.totals.totalIncome, helper: "movimento bancário", tone: "positive" },
      { key: "outflow", label: "Saiu", value: input.snapshot.totals.totalBankOutflows, helper: "movimento bancário", tone: "neutral" },
      { key: "result", label: "Resultado do mês", value: input.snapshot.totals.cashResult, helper: "entradas menos saídas", tone: input.snapshot.totals.cashResult < 0 ? "negative" : "positive" },
      { key: "closing", label: "Terminou com", value: input.snapshot.totals.closingBalance, helper: "saldo final", tone: input.snapshot.totals.closingBalance < 0 ? "negative" : "positive" },
      { key: "income", label: "Renda real", value: realIncome, helper: "sem transferências e resgates", tone: "accent" },
    ],
    narrative: buildNarrative({ snapshot: input.snapshot, blockers, firstMonth: input.snapshot.tracking.isFirstFinancialReport }),
    cashFlow: {
      series: input.snapshot.cashFlow ?? [],
      highlights: input.snapshot.highlights ? [
        { label: "Maior entrada", value: input.snapshot.highlights.largestInflow, description: movementDescription(input.snapshot, "inflow", input.snapshot.highlights.largestInflow) },
        { label: "Maior receita real", value: input.snapshot.highlights.largestRealIncome, description: input.snapshot.entries.find(entry => entry.kind === "revenue" && Math.abs(entry.amount - input.snapshot.highlights!.largestRealIncome) < 0.01)?.description ?? null },
        { label: "Maior saída", value: input.snapshot.highlights.largestOutflow, description: movementDescription(input.snapshot, "outflow", input.snapshot.highlights.largestOutflow) },
        { label: "Movimentações", value: input.snapshot.highlights.movementCount, description: null, count: true },
      ] : [],
    },
    income: {
      received: realIncome, reference: incomeReference,
      difference: incomeReference == null ? null : money(realIncome - incomeReference),
      percentage: incomeReference ? Math.round(((realIncome - incomeReference) / incomeReference) * 1000) / 10 : null,
      items: incomeItems, needsClassification: incomeNeedsClassification,
    },
    consumption: {
      direct: money(Math.max(0, input.snapshot.totals.personalConsumption - (input.snapshot.totals.personalCardConsumption ?? 0))),
      card: input.snapshot.totals.personalCardConsumption ?? money(input.snapshot.totals.totalCardConsumption - input.snapshot.totals.thirdPartyCardConsumption),
      total: input.snapshot.totals.personalConsumption,
      categories, uncategorizedCount: uncategorizedEntries.length,
      needsClassification: consumptionNeedsClassification,
    },
    commitments: {
      recurring: ownRecurring, household, householdUnclassified,
      dependents, dependentPeople: input.snapshot.dependentsCost?.people ?? [],
      total: totalCommitted,
      incomeShare: realIncome > 0 ? Math.round((totalCommitted / realIncome) * 1000) / 10 : null,
      available, partial: householdUnclassified || incomeNeedsClassification,
    },
    paidStatements, detectedStatements, openStatements,
    reimbursements: {
      received: input.snapshot.totals.reimbursementsReceived,
      pending: input.snapshot.totals.reimbursementsPending,
      people: input.snapshot.thirdPartySummary ?? [],
    },
    responsiblePurchases: { unresolved: unresolvedPurchases, ownCount, assignedCounts },
    installments: input.snapshot.installments,
    future: {
      months: future,
      closingBalance: input.snapshot.totals.closingBalance,
      nextCommitments: firstFuture?.total ?? 0,
      difference: money(input.snapshot.totals.closingBalance - (firstFuture?.total ?? 0)),
      reimbursementsPending: input.snapshot.totals.reimbursementsPending,
    },
    finalReview,
    versions: input.versions,
  };
}
