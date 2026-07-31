import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBankAccountMonthlyMovement,
  isTransactionalBankAccount,
} from "./account-movement";
import {
  buildCurrentCardInvoices,
  invoiceReferenceDateForMonth,
} from "./card-invoices";
import { buildFinanceDashboard } from "./dashboard";
import { buildFinanceOverviewDashboard } from "./finance-overview-dashboard";
import { getIncomeExpenseOverview } from "./income-expenses-query";
import {
  resolveFinanceMonthPeriod,
  shiftFinanceMonth,
} from "./monthly-result";
import {
  getBankAccountMonthlyTransactions,
  getFinanceProjectionCardData,
  getFinanceOverviewData,
  getReliableCurrentInvoiceSnapshots,
  resolveOpenCardInvoice,
} from "./queries";
import { getActiveFinanceWorkspaceContext } from "./workspace-context";

export async function getFinanceOverviewDashboard(input: {
  supabase: SupabaseClient;
  userId: string;
  selectedMonth?: string;
  selectedAccountId?: string;
  workspaceId: string | null;
  timeZone: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const requestedPeriod = resolveFinanceMonthPeriod({
    selectedMonth: input.selectedMonth,
    timeZone: input.timeZone,
    referenceDate: now,
  });
  const maximumPeriod = resolveFinanceMonthPeriod({
    timeZone: input.timeZone,
    referenceDate: now,
  });
  const period = requestedPeriod.startInstant > maximumPeriod.startInstant
    ? maximumPeriod
    : requestedPeriod;
  const activeWorkspace = await getActiveFinanceWorkspaceContext(input.workspaceId);
  const [data,projectionCards,storedInvoices]=await Promise.all([
    getFinanceOverviewData(input.supabase, input.userId, {
      period,
      workspaceId: input.workspaceId,
    }),
    getFinanceProjectionCardData(input.supabase,input.userId),
    getReliableCurrentInvoiceSnapshots(input.supabase,input.userId),
  ]);
  const accounts = data.accounts.filter(isTransactionalBankAccount);
  const selectedAccount = accounts.find(account => account.id === input.selectedAccountId)
    ?? accounts[0] ?? null;
  const selectedConnection = selectedAccount?.bank_connection_id
    ? data.connections.find(connection => connection.id === selectedAccount.bank_connection_id) ?? null
    : null;
  const futurePeriods = [1, 2, 3].map(offset => shiftFinanceMonth(period, offset));
  const [movementTransactions, previousMovementTransactions, currentFlow, ...futureFlows] = await Promise.all([
    selectedAccount
      ? getBankAccountMonthlyTransactions(input.supabase, input.userId, {
          accountId: selectedAccount.id, period, workspaceId: input.workspaceId,
        })
      : Promise.resolve([]),
    selectedAccount
      ? getBankAccountMonthlyTransactions(input.supabase, input.userId, {
          accountId: selectedAccount.id,
          period: shiftFinanceMonth(period, -1),
          workspaceId: input.workspaceId,
        })
      : Promise.resolve([]),
    getIncomeExpenseOverview(input.supabase, {
      workspaceId: activeWorkspace.workspaceId, month: period.key,
    }),
    ...futurePeriods.map(future => getIncomeExpenseOverview(input.supabase, {
      workspaceId: activeWorkspace.workspaceId, month: future.key,
    })),
  ]);
  const accountMovement = selectedAccount
    ? getBankAccountMonthlyMovement({
        account: selectedAccount,
        transactions: movementTransactions,
        previousTransactions: previousMovementTransactions,
        period,
        connection: selectedConnection,
      })
    : null;
  const invoiceReferenceDate = invoiceReferenceDateForMonth({
    year: period.year, month: period.month, now, timeZone: input.timeZone,
  });
  const invoices = buildCurrentCardInvoices(
    projectionCards.cards.filter(card => card.status === "active" && !card.user_archived_at),
    projectionCards.cardPurchases,
    invoiceReferenceDate,
    { purchaseDataAvailable: !projectionCards.partial,storedInvoices },
  ).filter(invoice => ["open", "partially_paid", "estimated"].includes(invoice.status));
  const resolvedInvoices = new Map(
    (await Promise.all(invoices.map(async invoice => {
      const resolved = await resolveOpenCardInvoice(input.supabase, input.userId, {
        workspaceId: input.workspaceId,
        cardAccountId: invoice.card.id,
        referenceDate: invoiceReferenceDate,
      });
      return resolved ? [invoice.card.id, resolved] as const : null;
    }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const legacyDashboard = buildFinanceDashboard(
    data.accounts,
    data.transactions,
    projectionCards.cardPurchases,
    invoices,
    data.connections,
    now,
    {
      selectedMonth: period.key,
      timeZone: input.timeZone,
      scope: { workspaceId: input.workspaceId },
    },
  );
  return {
    accounts,
    selectedAccountId: selectedAccount?.id,
    period,
    accountMovement,
    dashboard: buildFinanceOverviewDashboard({
      selectedMonth: period.key,
      nextMonth: futurePeriods[0]!.key,
      movement: accountMovement,
      invoices,
      resolvedInvoices,
      currentFlow,
      futureFlows,
      legacyDashboard,
      cardsPartial: projectionCards.partial,
    }),
    maximumMonth: maximumPeriod.key,
  };
}
