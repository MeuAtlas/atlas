import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinanceOverviewDashboard } from "./finance-overview-query";
import { getIncomeExpenseOverview } from "./income-expenses-query";
import { getMonthlyFinancialCommitments } from "./commitments-query";
import { buildPlanningDashboard } from "./planning-dashboard";

const monthStart = (value: string) => `${value.slice(0, 7)}-01`;

export function shiftPlanningMonth(value: string, offset: number) {
  const date = new Date(`${monthStart(value)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export async function getPlanningDashboard(input: {
  supabase: SupabaseClient;
  userId: string;
  workspaceId: string;
  startMonth: string;
  horizon: 3 | 6 | 12;
  accountId?: string | null;
  timeZone: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const currentMonth = now.toLocaleDateString("en-CA", {
    year: "numeric", month: "2-digit", timeZone: input.timeZone,
  }).slice(0, 7);
  const months = Array.from({ length: input.horizon }, (_, index) =>
    shiftPlanningMonth(input.startMonth, index));
  const [flows, commitments, overview] = await Promise.all([
    Promise.all(months.map(month => getIncomeExpenseOverview(input.supabase, {
      workspaceId: input.workspaceId,
      month,
    }))),
    getMonthlyFinancialCommitments(input.supabase, {
      workspaceId: input.workspaceId,
      from: monthStart(input.startMonth),
    }),
    getFinanceOverviewDashboard({
      supabase: input.supabase,
      userId: input.userId,
      selectedMonth: currentMonth,
      selectedAccountId: input.accountId ?? undefined,
      workspaceId: input.workspaceId,
      timeZone: input.timeZone,
      now,
    }),
  ]);
  const invoiceMonth = shiftPlanningMonth(currentMonth, 1);
  const commitmentByMonth = new Map(
    commitments.map(item => [item.competenceMonth.slice(0, 7), item]),
  );
  const accounts = overview.accounts.map(account => ({
    id: account.id,
    name: account.institution_name && account.institution_name !== account.name
      ? `${account.name} · ${account.institution_name}`
      : account.name,
  }));
  const selectedAccountId = input.accountId && accounts.some(account => account.id === input.accountId)
    ? input.accountId
    : null;
  return buildPlanningDashboard({
    workspaceId: input.workspaceId,
    startMonth: input.startMonth,
    horizon: input.horizon,
    accountId: selectedAccountId,
    accounts,
    months: flows.map(flow => ({
      flow,
      invoices: flow.month.slice(0, 7) === invoiceMonth
        ? overview.dashboard.nextPeriod.upcomingInvoices
        : [],
      commitments: commitmentByMonth.get(flow.month.slice(0, 7)),
    })),
  });
}
