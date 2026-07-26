import type { ReactNode } from "react";

import { Money } from "./value-visibility";
import type { BankAccountMonthlyMovement } from "@/modules/finance/account-movement";

export function CurrentAccountBalanceCard({
  movement,
  timeZone,
  filters,
}: {
  movement: BankAccountMonthlyMovement;
  timeZone: string;
  filters: ReactNode;
}) {
  const syncLabel = movement.lastSyncAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone,
      }).format(new Date(movement.lastSyncAt))
    : movement.source === "manual"
      ? "conta manual"
      : "sincronização não informada";

  return (
    <section
      className="current-account-balance-card"
      aria-labelledby="current-account-balance-title"
    >
      <div className="current-account-balance-value">
        <p id="current-account-balance-title">Saldo atual da conta</p>
        <strong>
          <Money value={movement.currentBalance} />
        </strong>
        <small>Atualizado em {syncLabel}</small>
      </div>
      <div
        className="current-account-balance-filters"
        aria-label="Filtros da visão geral"
      >
        {filters}
      </div>
    </section>
  );
}
