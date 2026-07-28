import { FinanceOverview } from "@/components/finance/finance-overview";
import {
  getBankAccountMonthlyMovement,
  isTransactionalBankAccount,
} from "@/modules/finance/account-movement";
import { requireFinanceAccess } from "@/modules/finance/access";
import {
  buildCurrentCardInvoices,
  invoiceReferenceDateForMonth,
} from "@/modules/finance/card-invoices";
import { buildFinanceDashboard } from "@/modules/finance/dashboard";
import {
  resolveFinanceMonthPeriod,
  shiftFinanceMonth,
} from "@/modules/finance/monthly-result";
import {
  getBankAccountMonthlyTransactions,
  getFinanceOverviewData,
  resolveOpenCardInvoice,
} from "@/modules/finance/queries";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string | string[];
    account?: string | string[];
    workspace?: string | string[];
    details?: string | string[];
  }>;
}) {
  const { supabase, user, profile } = await requireFinanceAccess();
  const params = await searchParams;
  const selectedMonth =
    typeof params.month === "string" ? params.month : undefined;
  const selectedAccountParam =
    typeof params.account === "string" ? params.account : undefined;
  const workspaceParam =
    typeof params.workspace === "string" ? params.workspace : undefined;
  const detailsParam =
    params.details === "inflow" || params.details === "outflow"
      ? params.details
      : undefined;
  const workspaceId =
    workspaceParam && UUID.test(workspaceParam) ? workspaceParam : null;
  const timeZone = profile.timezone || "America/Sao_Paulo";
  const now = new Date();
  const period = resolveFinanceMonthPeriod({
    selectedMonth,
    timeZone,
  });
  const data = await getFinanceOverviewData(supabase, user.id, {
    period,
    workspaceId,
  });
  const bankAccounts = data.accounts.filter(isTransactionalBankAccount);
  const selectedAccount =
    bankAccounts.find((account) => account.id === selectedAccountParam) ??
    bankAccounts[0] ??
    null;
  const [movementTransactions, previousMovementTransactions] = selectedAccount
    ? await Promise.all([
        getBankAccountMonthlyTransactions(supabase, user.id, {
          accountId: selectedAccount.id,
          period,
          workspaceId,
        }),
        getBankAccountMonthlyTransactions(supabase, user.id, {
          accountId: selectedAccount.id,
          period: shiftFinanceMonth(period, -1),
          workspaceId,
        }),
      ])
    : [[], []];
  const selectedConnection = selectedAccount?.bank_connection_id
    ? data.connections.find(
        (connection) => connection.id === selectedAccount.bank_connection_id,
      ) ?? null
    : null;
  const accountMovement = selectedAccount
    ? getBankAccountMonthlyMovement({
        account: selectedAccount,
        transactions: movementTransactions,
        previousTransactions: previousMovementTransactions,
        period,
        connection: selectedConnection,
      })
    : null;
  const invoices = buildCurrentCardInvoices(
    data.cards.filter(
      (card) => card.status === "active" && !card.user_archived_at,
    ),
    data.cardPurchases,
    invoiceReferenceDateForMonth({
      year: period.year,
      month: period.month,
      now,
      timeZone,
    }),
    { purchaseDataAvailable: !data.warnings.cardPurchases },
  ).filter((invoice) =>
    ["open", "partially_paid", "estimated"].includes(invoice.status),
  );
  const resolvedInvoices = new Map(
    (await Promise.all(invoices.map(async invoice => {
      const resolved = await resolveOpenCardInvoice(supabase, user.id, {
        workspaceId,
        cardAccountId: invoice.card.id,
        referenceDate: now,
      });
      return resolved ? [invoice.card.id, resolved] as const : null;
    }))).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  );
  const dashboard = buildFinanceDashboard(
    data.accounts,
    data.transactions,
    data.cardPurchases,
    invoices,
    data.connections,
    now,
    {
      selectedMonth: period.key,
      timeZone,
      scope: { workspaceId },
    },
  );

  return (
    <FinanceOverview
      dashboard={dashboard}
      accounts={bankAccounts}
      accountMovement={accountMovement}
      invoices={invoices}
      resolvedInvoices={resolvedInvoices}
      name={profile.preferred_name || profile.full_name || "você"}
      timeZone={timeZone}
      workspace={workspaceParam || "personal"}
      warnings={data.warnings}
      initialDetails={detailsParam}
    />
  );
}
