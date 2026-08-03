import {
  type FinancialMonthRecord,
  type MonthlyReportRecord,
} from "./monthly-financial-report-query";
import type {
  MonthlyReportSnapshot,
  MonthlyStatement,
} from "./monthly-financial-report";

export type FinancialMonthDisplayStatus =
  | "planned"
  | "open"
  | "review"
  | "closed"
  | "reopened"
  | "needs_attention";

export type FinancialMonthCardState =
  | { kind: "paid"; paid: number; expected: number }
  | { kind: "partial"; paid: number; expected: number }
  | { kind: "identified"; paid: number; expected: number }
  | { kind: "forecast"; forecast: number; expected: number }
  | { kind: "unavailable" };

export type ActiveFinancialMonth = {
  month: FinancialMonthRecord;
  displayStatus: FinancialMonthDisplayStatus;
  snapshot: MonthlyReportSnapshot;
  card: FinancialMonthCardState;
};

export type ClosedFinancialMonth = {
  month: FinancialMonthRecord;
  report: MonthlyReportRecord | null;
};

type MonthCoordinate = { year: number; month: number };
type MonthWithReport = FinancialMonthRecord & {
  monthly_financial_reports?: MonthlyReportRecord | MonthlyReportRecord[] | null;
};

const monthIndex = ({ year, month }: MonthCoordinate) => year * 12 + month;
const rowIndex = (row: Pick<FinancialMonthRecord, "reference_year" | "reference_month">) =>
  monthIndex({ year: row.reference_year, month: row.reference_month });

export function financeToday(now = new Date()): MonthCoordinate {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);
  return {
    year: Number(parts.find(part => part.type === "year")?.value),
    month: Number(parts.find(part => part.type === "month")?.value),
  };
}

export function shiftMonth(value: MonthCoordinate, offset: number): MonthCoordinate {
  const date = new Date(Date.UTC(value.year, value.month - 1 + offset, 1, 12));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function getFinancialMonthDisplayState(input: {
  month: FinancialMonthRecord;
  current: MonthCoordinate;
  hasBlockingIssues?: boolean;
}): FinancialMonthDisplayStatus {
  if (input.month.status === "closed") return "closed";
  if (input.month.status === "reopened") return "reopened";
  const position = rowIndex(input.month) - monthIndex(input.current);
  if (position > 0 || input.month.status === "planned") return "planned";
  if (position === 0) return "open";
  if (input.hasBlockingIssues || input.month.status === "needs_attention") {
    return "needs_attention";
  }
  return "review";
}

export function getFinancialMonthAction(status: FinancialMonthDisplayStatus) {
  return {
    open: "Acompanhar",
    review: "Revisar e concluir",
    planned: "Ver previsão",
    closed: "Ver relatório",
    reopened: "Continuar correção",
    needs_attention: "Resolver pendências",
  }[status];
}

export function selectActiveFinancialMonths(
  months: FinancialMonthRecord[],
  current: MonthCoordinate,
) {
  const currentValue = monthIndex(current);
  const openMonths = months.filter(month => month.status !== "closed");
  const previous = openMonths
    .filter(month => rowIndex(month) < currentValue)
    .sort((a, b) => rowIndex(b) - rowIndex(a))[0];
  const currentMonth = openMonths.find(month => rowIndex(month) === currentValue);
  const nextValue = monthIndex(shiftMonth(current, 1));
  const nextMonth = openMonths.find(month => rowIndex(month) === nextValue);
  return previous
    ? [previous, currentMonth].filter((month): month is FinancialMonthRecord => Boolean(month))
    : [currentMonth, nextMonth].filter((month): month is FinancialMonthRecord => Boolean(month));
}

export function getStatementForCashMonth(input: {
  statements: MonthlyStatement[];
  reconciliationStatements?: MonthlyStatement[];
  unmatchedPaymentCount?: number;
}): FinancialMonthCardState {
  const paid = input.statements.filter(statement => statement.payments.length > 0);
  if (paid.length) {
    const paidAmount = paid.reduce((sum, statement) => sum + statement.confirmed_payment_amount, 0);
    const expected = paid.reduce((sum, statement) => sum + statement.expected_statement_amount, 0);
    const tolerance = Math.max(0.01, Math.min(1, expected * 0.001));
    return paidAmount + tolerance < expected
      ? { kind: "partial", paid: paidAmount, expected }
      : { kind: "paid", paid: paidAmount, expected };
  }
  const forecastStatements = input.reconciliationStatements ?? [];
  const expected = forecastStatements.reduce((sum, statement) =>
    sum + statement.expected_statement_amount, 0);
  if ((input.unmatchedPaymentCount ?? 0) > 0 && forecastStatements.length) {
    return { kind: "identified", paid: 0, expected };
  }
  if (forecastStatements.length) {
    const forecast = forecastStatements.reduce((sum, statement) =>
      sum + (statement.current_open_amount || statement.expected_statement_amount), 0);
    return { kind: "forecast", forecast, expected };
  }
  return { kind: "unavailable" };
}

export function selectClosedFinancialMonths(months: MonthWithReport[], limit = 6) {
  return months
    .filter(month => month.status === "closed" || Boolean(month.current_report_id))
    .sort((a, b) => rowIndex(b) - rowIndex(a))
    .slice(0, limit)
    .map(month => {
      const value = month.monthly_financial_reports;
      const report = (Array.isArray(value) ? value[0] : value) ?? null;
      return { month, report } satisfies ClosedFinancialMonth;
    });
}
