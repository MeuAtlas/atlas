"use client";

import { useState } from "react";

import { closeFinancialMonth } from "@/app/financeiro/relatorios/actions";
import { Money } from "./value-visibility";

export function MonthlyReportCloseDialog({
  workspaceId,
  year,
  month,
  monthLabel,
  result,
  closingBalance,
  paidCard,
  nextVersion,
}: {
  workspaceId: string;
  year: number;
  month: number;
  monthLabel: string;
  result: number;
  closingBalance: number;
  paidCard: number;
  nextVersion: number;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button className="finance-button monthly-close-trigger" type="button" onClick={() => setOpen(true)}>
      Concluir {monthLabel}
    </button>
    {open ? <div className="atlas-modal-backdrop monthly-close-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setOpen(false);
    }}>
      <section className="atlas-modal atlas-modal-small monthly-close-modal" role="dialog" aria-modal="true" aria-labelledby="monthly-close-title">
        <header className="atlas-modal-header">
          <div><p className="eyebrow">Revisão concluída</p><h2 id="monthly-close-title">Concluir {monthLabel} de {year}?</h2></div>
          <button className="atlas-modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cancelar conclusão">×</button>
        </header>
        <form action={closeFinancialMonth}>
          <input type="hidden" name="workspace_id" value={workspaceId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <div className="atlas-modal-body monthly-close-summary">
            <dl>
              <div><dt>Resultado do mês</dt><dd className={result < 0 ? "negative" : "positive"}><Money value={result} /></dd></div>
              <div><dt>Saldo final</dt><dd><Money value={closingBalance} /></dd></div>
              <div><dt>Fatura paga</dt><dd><Money value={paidCard} /></dd></div>
            </dl>
            <p>Ao concluir, este relatório será congelado como versão {nextVersion}. O Atlas salvará o snapshot e gerará o PDF final.</p>
          </div>
          <footer className="atlas-modal-footer">
            <button className="finance-button secondary" type="button" onClick={() => setOpen(false)}>Cancelar</button>
            <button className="finance-button" type="submit">Concluir relatório</button>
          </footer>
        </form>
      </section>
    </div> : null}
  </>;
}
