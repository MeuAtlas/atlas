import type { FinancialAccount } from "@/modules/finance/types";
import { ClientSearchForm } from "@/components/navigation/client-navigation";

function accountLabel(account: FinancialAccount) {
  const identity =
    account.institution_name && account.institution_name !== account.name
      ? `${account.name} — ${account.institution_name}`
      : account.name;
  return account.source === "pluggy" ? `${identity} · Pluggy` : identity;
}

export function FinanceAccountFilters({
  accounts,
  accountId,
  month,
  workspace,
  maximumMonth,
}: {
  accounts: FinancialAccount[];
  accountId?: string;
  month: string;
  workspace: string;
  maximumMonth?: string;
}) {
  return (
    <ClientSearchForm action="/financeiro" className="overview-period">
      <input type="hidden" name="workspace" value={workspace} />
      <label>
        <span>Conta</span>
        <select
          name="account"
          defaultValue={accountId}
          aria-label="Conta bancária da movimentação"
          disabled={!accounts.length}
        >
          {accounts.length ? (
            accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {accountLabel(account)}
              </option>
            ))
          ) : (
            <option value="">Nenhuma conta bancária</option>
          )}
        </select>
      </label>
      <label>
        <span>Período</span>
        <input
          type="month"
          name="month"
          defaultValue={month}
          max={maximumMonth}
          aria-label="Mês da visão geral financeira"
        />
      </label>
      <button type="submit">Aplicar</button>
    </ClientSearchForm>
  );
}
