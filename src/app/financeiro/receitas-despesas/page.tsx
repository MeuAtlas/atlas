import { IncomeExpensesWorkspace } from "@/components/finance/income-expenses/income-expenses-workspace";
import {
  ensureRollingCommitmentOccurrences,
} from "@/modules/finance/commitments-actions";
import {
  getCommitmentsOverview,
  refreshOccurrenceStatuses,
} from "@/modules/finance/commitments-query";
import { getIncomeExpenseOverview } from "@/modules/finance/income-expenses-query";
import { getExpenseEstablishmentAnalyses } from "@/modules/finance/expense-establishment-query";
import { getActiveFinanceWorkspaceContext } from "@/modules/finance/workspace-context";

export default async function IncomeExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspace?: string;
    month?: string;
    tab?: "overview" | "income" | "expenses" | "eventual" | "people";
    expense_filter?: "all" | "open" | "paid" | "overdue" | "automatic";
    eventual_search?: string;
    eventual_order?: "highest" | "lowest" | "count" | "above_median" | "name";
    eventual_establishment?: string;
  }>;
}) {
  const params = await searchParams;
  const context = await getActiveFinanceWorkspaceContext(params.workspace);
  const month = /^\d{4}-\d{2}$/.test(params.month ?? "")
    ? params.month!
    : new Date().toISOString().slice(0, 7);
  const expenseFilter = ["all", "open", "paid", "overdue", "automatic"].includes(
    params.expense_filter ?? "",
  ) ? params.expense_filter! : "all";
  await ensureRollingCommitmentOccurrences(context.workspaceId);
  await refreshOccurrenceStatuses(context.supabase, context.workspaceId);
  const from = new Date(`${month}-01T12:00:00Z`);
  from.setUTCMonth(from.getUTCMonth() - 12);
  const [data, establishmentAnalyses, legacyOverview, workspaces, categories, accounts, cards, references, expenseReferences] =
    await Promise.all([
      getIncomeExpenseOverview(context.supabase, {
        workspaceId: context.workspaceId,
        month,
      }),
      params.tab === "eventual"
        ? getExpenseEstablishmentAnalyses(context.supabase, context.workspaceId, month)
        : Promise.resolve([]),
      getCommitmentsOverview(context.supabase, context.userId, {
        workspaceId: context.workspaceId,
        month,
      }),
      context.supabase.from("workspaces")
        .select("id,name").order("type"),
      context.supabase.from("financial_categories")
        .select("id,name").order("name"),
      context.supabase.from("financial_accounts")
        .select("id,name,institution_name,status")
        .eq("owner_id", context.userId)
        .eq("status", "active")
        .order("name"),
      context.supabase.from("credit_cards")
        .select("id,name,last_four_digits,status,user_archived_at")
        .eq("owner_id", context.userId)
        .eq("status", "active")
        .is("user_archived_at", null)
        .order("name"),
      context.supabase.from("financial_transactions")
        .select(
          "id,description,amount,competence_date,bank_direction,transaction_type,workspace_id,owner_id,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name)",
        )
        .eq("owner_id", context.userId)
        .gte("competence_date", from.toISOString().slice(0, 10))
        .or("bank_direction.eq.inflow,transaction_type.eq.income")
        .order("competence_date", { ascending: false })
        .limit(200),
      context.supabase.from("financial_transactions")
        .select("id,description,amount,competence_date,workspace_id,owner_id,financial_accounts:financial_accounts!financial_transactions_account_id_fkey(name,institution_name)")
        .eq("owner_id", context.userId)
        .gte("competence_date", from.toISOString().slice(0, 10))
        .eq("bank_direction", "outflow")
        .order("competence_date", { ascending: false })
        .limit(200),
    ]);
  const referenceTransactions = (references.data ?? [])
    .filter(item =>
      item.workspace_id === context.workspaceId ||
      (item.workspace_id === null && item.owner_id === context.userId)
    )
    .map(item => {
      const account = Array.isArray(item.financial_accounts)
        ? item.financial_accounts[0]
        : item.financial_accounts;
      return {
        id: String(item.id),
        description: String(item.description),
        amountCents: Math.round(Math.abs(Number(item.amount)) * 100),
        date: String(item.competence_date),
        accountName: [
          account?.institution_name,
          account?.name,
        ].filter(Boolean).join(" · ") || "Conta bancária",
      };
    });
  const expenseReferenceTransactions = (expenseReferences.data ?? [])
    .filter(item => item.workspace_id === context.workspaceId ||
      (item.workspace_id === null && item.owner_id === context.userId))
    .map(item => {
      const account = Array.isArray(item.financial_accounts)
        ? item.financial_accounts[0] : item.financial_accounts;
      return { id: String(item.id), description: String(item.description),
        amountCents: Math.round(Math.abs(Number(item.amount)) * 100),
        date: String(item.competence_date),
        accountName: [account?.institution_name, account?.name]
          .filter(Boolean).join(" · ") || "Conta bancária" };
    });
  return (
    <IncomeExpensesWorkspace
      data={data}
      activeTab={params.tab ?? "overview"}
      expenseFilter={expenseFilter}
      establishmentAnalyses={establishmentAnalyses}
      eventualSearch={params.eventual_search?.slice(0, 120) ?? ""}
      eventualOrder={params.eventual_order ?? "highest"}
      eventualEstablishmentId={params.eventual_establishment}
      workspaces={(workspaces.data ?? []).map(item => ({
        id: String(item.id),
        name: String(item.name),
      }))}
      people={legacyOverview.people}
      categories={(categories.data ?? []).map(item => ({
        id: String(item.id),
        name: String(item.name),
      }))}
      accounts={(accounts.data ?? []).map(item => ({
        id: String(item.id),
        name: item.institution_name
          ? `${item.institution_name} · ${item.name}`
          : String(item.name),
      }))}
      cards={(cards.data ?? []).map(item => ({
        id: String(item.id),
        name: `${item.name}${
          item.last_four_digits ? ` · final ${item.last_four_digits}` : ""
        }`,
      }))}
      referenceTransactions={referenceTransactions}
      expenseReferenceTransactions={expenseReferenceTransactions}
    />
  );
}
