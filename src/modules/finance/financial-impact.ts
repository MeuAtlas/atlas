export type IncomeBasis = "net" | "gross" | "unknown";
export type CashFlowEffect = "inflow" | "outflow" | "none";
export type PlanningEffect =
  | "increase"
  | "decrease"
  | "informational"
  | "none";
export type AnalyticsEffect =
  | "income"
  | "expense"
  | "reimbursement"
  | "transfer"
  | "informational"
  | "none";
export type ExpensePaymentChannel =
  | "bank"
  | "card"
  | "payroll"
  | "manual"
  | "other";

export type CommitmentFinancialEffects = {
  incomeBasis: IncomeBasis | null;
  cashFlowEffect: CashFlowEffect;
  planningEffect: PlanningEffect;
  analyticsEffect: AnalyticsEffect;
  paymentChannel: ExpensePaymentChannel;
  isPayrollDeduction: boolean;
};

export type FinancialImpactItem = CommitmentFinancialEffects & {
  expectedCents: number;
  realizedCents: number;
  status: string;
};

export type FinancialImpactSummary = {
  netIncomeExpected: number;
  netIncomeReceived: number;
  cashExpensesExpected: number;
  cashExpensesRealized: number;
  payrollDeductions: number;
  projectedAvailable: number;
  realizedAvailable: number;
  analyticalExpensesTotal: number;
};

type EffectSource = {
  direction?: "income" | "expense" | null;
  commitmentType?: string | null;
  paymentMethod?: string | null;
  isPayrollDeduction?: boolean | null;
  incomeBasis?: IncomeBasis | null;
  cashFlowEffect?: CashFlowEffect | null;
  planningEffect?: PlanningEffect | null;
  analyticsEffect?: AnalyticsEffect | null;
  paymentChannel?: ExpensePaymentChannel | null;
};

const PAYROLL_METHODS = new Set(["payroll", "payroll_deduction"]);
const CARD_METHODS = new Set(["credit_card", "card"]);
const BANK_METHODS = new Set([
  "bank_debit",
  "automatic_debit",
  "pix",
  "boleto",
  "transfer",
]);

export function resolveCommitmentFinancialEffects(
  source: EffectSource,
): CommitmentFinancialEffects {
  const direction = source.direction === "income" ? "income" : "expense";
  const payroll = Boolean(source.isPayrollDeduction) ||
    source.commitmentType === "payroll_deduction" ||
    PAYROLL_METHODS.has(source.paymentMethod ?? "") ||
    source.paymentChannel === "payroll";

  if (direction === "income") {
    return {
      incomeBasis: source.incomeBasis ?? "net",
      cashFlowEffect: "inflow",
      planningEffect: "increase",
      analyticsEffect: "income",
      paymentChannel: source.paymentChannel ?? "bank",
      isPayrollDeduction: false,
    };
  }
  if (payroll) {
    return {
      incomeBasis: null,
      cashFlowEffect: "none",
      planningEffect: "informational",
      analyticsEffect: "expense",
      paymentChannel: "payroll",
      isPayrollDeduction: true,
    };
  }

  const paymentChannel = source.paymentChannel ??
    (CARD_METHODS.has(source.paymentMethod ?? "")
      ? "card"
      : BANK_METHODS.has(source.paymentMethod ?? "")
        ? "bank"
        : source.paymentMethod === "manual" || source.paymentMethod === "cash"
          ? "manual"
          : "other");
  return {
    incomeBasis: null,
    cashFlowEffect: source.cashFlowEffect ?? "outflow",
    planningEffect: source.planningEffect ?? "decrease",
    analyticsEffect: source.analyticsEffect ?? "expense",
    paymentChannel,
    isPayrollDeduction: false,
  };
}

const TERMINAL_STATUSES = new Set([
  "paid",
  "received",
  "above_expected",
  "below_expected",
  "cancelled",
  "skipped",
  "disputed",
]);
const IGNORED_STATUSES = new Set(["cancelled", "skipped", "disputed"]);

export function calculateFinancialImpactSummary(
  items: FinancialImpactItem[],
): FinancialImpactSummary {
  const summary: FinancialImpactSummary = {
    netIncomeExpected: 0,
    netIncomeReceived: 0,
    cashExpensesExpected: 0,
    cashExpensesRealized: 0,
    payrollDeductions: 0,
    projectedAvailable: 0,
    realizedAvailable: 0,
    analyticalExpensesTotal: 0,
  };

  for (const item of items) {
    if (IGNORED_STATUSES.has(item.status)) continue;
    const expected = Math.max(0, Math.round(item.expectedCents));
    const realized = Math.max(0, Math.round(item.realizedCents));
    if (item.analyticsEffect === "income") {
      summary.netIncomeExpected += expected;
      summary.netIncomeReceived += realized;
      continue;
    }
    if (item.analyticsEffect !== "expense") continue;

    const analyticalAmount = realized || expected;
    summary.analyticalExpensesTotal += analyticalAmount;
    if (item.isPayrollDeduction || item.paymentChannel === "payroll") {
      summary.payrollDeductions += analyticalAmount;
      continue;
    }
    if (item.cashFlowEffect === "outflow") {
      summary.cashExpensesRealized += realized;
    }
    if (
      item.planningEffect === "decrease" &&
      !TERMINAL_STATUSES.has(item.status)
    ) {
      summary.cashExpensesExpected += Math.max(expected - realized, 0);
    }
  }

  summary.projectedAvailable =
    summary.netIncomeExpected - summary.cashExpensesExpected;
  summary.realizedAvailable =
    summary.netIncomeReceived - summary.cashExpensesRealized;
  return summary;
}

export function calculateNetIncomeSummary(items: FinancialImpactItem[]) {
  const summary = calculateFinancialImpactSummary(items);
  return {
    expectedNetIncome: summary.netIncomeExpected,
    receivedNetIncome: summary.netIncomeReceived,
  };
}

export function calculateCashExpenseSummary(items: FinancialImpactItem[]) {
  const summary = calculateFinancialImpactSummary(items);
  return {
    expectedCashExpenses: summary.cashExpensesExpected,
    realizedCashExpenses: summary.cashExpensesRealized,
  };
}

export function calculatePayrollDeductionSummary(
  items: FinancialImpactItem[],
) {
  return {
    payrollDeductionsInformational:
      calculateFinancialImpactSummary(items).payrollDeductions,
  };
}

export function calculateProjectedAvailableIncome(
  items: FinancialImpactItem[],
) {
  const summary = calculateFinancialImpactSummary(items);
  return {
    expectedNetIncome: summary.netIncomeExpected,
    expectedBankExpenses: items
      .filter(item =>
        item.paymentChannel === "bank" &&
        item.planningEffect === "decrease" &&
        !TERMINAL_STATUSES.has(item.status)
      )
      .reduce(
        (sum, item) =>
          sum + Math.max(item.expectedCents - item.realizedCents, 0),
        0,
      ),
    expectedCardExpenses: items
      .filter(item =>
        item.paymentChannel === "card" &&
        item.planningEffect === "decrease" &&
        !TERMINAL_STATUSES.has(item.status)
      )
      .reduce(
        (sum, item) =>
          sum + Math.max(item.expectedCents - item.realizedCents, 0),
        0,
      ),
    expectedManualExpenses: items
      .filter(item =>
        ["manual", "other"].includes(item.paymentChannel) &&
        item.planningEffect === "decrease" &&
        !TERMINAL_STATUSES.has(item.status)
      )
      .reduce(
        (sum, item) =>
          sum + Math.max(item.expectedCents - item.realizedCents, 0),
        0,
      ),
    payrollDeductionsInformational: summary.payrollDeductions,
    projectedAvailableAmount: summary.projectedAvailable,
  };
}

export function calculateRealizedAvailableIncome(
  items: FinancialImpactItem[],
) {
  const summary = calculateFinancialImpactSummary(items);
  return {
    receivedNetIncome: summary.netIncomeReceived,
    realizedCashExpenses: summary.cashExpensesRealized,
    payrollDeductionsInformational: summary.payrollDeductions,
    realizedAvailableAmount: summary.realizedAvailable,
  };
}

export function calculateAnalyticalExpenseSummary(
  items: FinancialImpactItem[],
) {
  const summary = calculateFinancialImpactSummary(items);
  return {
    cashExpenses: summary.cashExpensesRealized,
    payrollDeductions: summary.payrollDeductions,
    analyticalExpensesTotal: summary.analyticalExpensesTotal,
  };
}

export type RealizedCashFlowTransaction = {
  amountCents: number;
  cashFlowEffect: CashFlowEffect;
  kind?:
    | "card_invoice_payment"
    | "transfer"
    | "investment_application"
    | "investment_redemption"
    | "payroll_deduction"
    | "other";
};

export function calculateRealizedCashFlow(
  transactions: RealizedCashFlowTransaction[],
) {
  const result = {
    bankInflows: 0,
    bankOutflows: 0,
    cardInvoicePayments: 0,
    transfersIn: 0,
    transfersOut: 0,
    investmentApplications: 0,
    investmentRedemptions: 0,
    payrollDeductionsExcluded: 0,
    netCashFlow: 0,
  };
  for (const transaction of transactions) {
    const amount = Math.max(0, Math.round(transaction.amountCents));
    if (transaction.kind === "payroll_deduction") {
      result.payrollDeductionsExcluded += amount;
      continue;
    }
    if (transaction.kind === "card_invoice_payment") {
      result.cardInvoicePayments += amount;
    } else if (transaction.kind === "investment_application") {
      result.investmentApplications += amount;
    } else if (transaction.kind === "investment_redemption") {
      result.investmentRedemptions += amount;
    } else if (transaction.kind === "transfer") {
      if (transaction.cashFlowEffect === "inflow") result.transfersIn += amount;
      if (transaction.cashFlowEffect === "outflow") result.transfersOut += amount;
    }
    if (transaction.cashFlowEffect === "inflow") result.bankInflows += amount;
    if (transaction.cashFlowEffect === "outflow") result.bankOutflows += amount;
  }
  result.netCashFlow = result.bankInflows - result.bankOutflows;
  return result;
}
