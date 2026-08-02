import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateBankCashFlowForAccounts,
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
  const financialDataWorkspaceId = activeWorkspace.includeOwnerPrivateData
    ? null
    : activeWorkspace.workspaceId;
  const [data,projectionCards,storedInvoices]=await Promise.all([
    getFinanceOverviewData(input.supabase, input.userId, {
      period,
      workspaceId: financialDataWorkspaceId,
    }),
    getFinanceProjectionCardData(input.supabase,input.userId,financialDataWorkspaceId),
    getReliableCurrentInvoiceSnapshots(input.supabase,input.userId,financialDataWorkspaceId),
  ]);
  const accounts = data.accounts.filter(isTransactionalBankAccount);
  const selectedAccount = accounts.find(account => account.id === input.selectedAccountId)
    ?? accounts[0] ?? null;
  const selectedConnection = selectedAccount?.bank_connection_id
    ? data.connections.find(connection => connection.id === selectedAccount.bank_connection_id) ?? null
    : null;
  const futurePeriods = [1, 2, 3].map(offset => shiftFinanceMonth(period, offset));
  const subsequentPeriod = {
    ...period,
    startDate: period.endExclusiveDate,
    startInstant: period.endExclusiveInstant,
    endExclusiveDate: maximumPeriod.endExclusiveDate,
    endExclusiveInstant: maximumPeriod.endExclusiveInstant,
  };
  const [movementTransactions, previousMovementTransactions, subsequentMovementTransactions, currentFlow, ...futureFlows] = await Promise.all([
    selectedAccount
      ? getBankAccountMonthlyTransactions(input.supabase, input.userId, {
          accountId: selectedAccount.id, period, workspaceId: financialDataWorkspaceId,
        })
      : Promise.resolve([]),
    selectedAccount
      ? getBankAccountMonthlyTransactions(input.supabase, input.userId, {
          accountId: selectedAccount.id,
          period: shiftFinanceMonth(period, -1),
          workspaceId: financialDataWorkspaceId,
        })
      : Promise.resolve([]),
    selectedAccount && period.endExclusiveDate < maximumPeriod.endExclusiveDate
      ? getBankAccountMonthlyTransactions(input.supabase, input.userId, {
          accountId: selectedAccount.id,
          period: subsequentPeriod,
          workspaceId: financialDataWorkspaceId,
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
  const subsequentCashFlow = selectedAccount
    ? calculateBankCashFlowForAccounts({
        accountIds: [selectedAccount.id],
        transactions: subsequentMovementTransactions,
        period: subsequentPeriod,
      })
    : null;
  const selectedPeriodClosingBalance = selectedAccount
    ? selectedAccount.current_balance - (subsequentCashFlow?.netMovement ?? 0)
    : 0;
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
        workspaceId: financialDataWorkspaceId,
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
      scope: { workspaceId: financialDataWorkspaceId },
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
      closingBalance: selectedPeriodClosingBalance,
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
