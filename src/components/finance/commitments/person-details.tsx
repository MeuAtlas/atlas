"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CommitmentsOverview } from "@/modules/finance/commitments-query";
import {
  resolvePersonDashboardPeriod,
  selectPersonFinancialDashboard,
  type PersonDashboardPeriod,
  type PersonFinancialDashboardData,
} from "@/modules/finance/person-financial-dashboard";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";

type PersonRow = CommitmentsOverview["people"][number];
type PeriodKey = PersonDashboardPeriod["key"];

const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
const percentage = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
        new Date(`${value}T12:00:00Z`),
      )
    : "Sem data";
const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}-01T12:00:00Z`)).replace(".", "");

const periodOptions: Array<[PeriodKey, string]> = [
  ["this_month", "Este mês"],
  ["previous_month", "Mês anterior"],
  ["last_3", "Últimos 3 meses"],
  ["last_6", "Últimos 6 meses"],
  ["year", "Este ano"],
  ["custom", "Personalizado"],
];

const paymentLabels: Record<string, string> = {
  bank_debit: "Débito em conta",
  credit_card: "Cartão de crédito",
  payroll: "Folha de pagamento",
  pix: "Pix",
  boleto: "Boleto",
  cash: "Dinheiro",
  transfer: "Transferência",
  other: "Outro",
};

export function PersonDetails({
  item,
  dashboardData,
  referenceMonth,
  relationLabel,
  onEdit,
  onAddCommitment,
  onArchive,
}: {
  item: PersonRow;
  dashboardData: PersonFinancialDashboardData;
  referenceMonth: string;
  relationLabel: (value: string) => string;
  onEdit: () => void;
  onAddCommitment: () => void;
  onArchive: () => void;
}) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("this_month");
  const [customFrom, setCustomFrom] = useState(referenceMonth);
  const [customTo, setCustomTo] = useState(referenceMonth);
  const [averageMonths, setAverageMonths] = useState<3 | 6 | 12>(6);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const period = useMemo(
    () => resolvePersonDashboardPeriod(periodKey, referenceMonth, {
      from: customFrom,
      to: customTo,
    }),
    [periodKey, referenceMonth, customFrom, customTo],
  );
  const dashboard = useMemo(
    () => selectPersonFinancialDashboard({
      data: dashboardData,
      period,
      referenceMonth,
      averageMonths,
    }),
    [dashboardData, period, referenceMonth, averageMonths],
  );
  const movements = dashboard.movements.filter(movement =>
    (!categoryFilter || movement.categoryName === categoryFilter) &&
    (!accountFilter || movement.accountName === accountFilter) &&
    (!kindFilter ||
      (kindFilter === "pix" && movement.isPix) ||
      (kindFilter === "reimbursement" && movement.isReimbursement) ||
      movement.recurrenceType === kindFilter)
  );
  const categories = [...new Set(
    dashboard.movements.map(movement => movement.categoryName),
  )].sort();
  const accounts = [...new Set(
    dashboard.movements.map(movement => movement.accountName),
  )].sort();
  const trendMaximum = Math.max(
    ...dashboard.monthlyTrend.map(point => point.netSpent),
    dashboard.summary.monthlyAverage,
    1,
  );
  const variationCopy = dashboard.summary.variationPercentage === null
    ? "Sem base de comparação"
    : `${percentage(dashboard.summary.variationPercentage)}%`;

  return (
    <div className="commitment-detail person-dashboard">
      <AtlasModalHeader className="person-dashboard-header">
        <div>
          <p className="eyebrow">
            {relationLabel(item.person.relationType)}
          </p>
          <h2>{item.person.name}</h2>
          <p className="atlas-modal-subtitle">
            {item.person.isDependent
              ? "Dependente financeiro"
              : "Pessoa vinculada ao planejamento"}
          </p>
        </div>
        <div className="person-dashboard-period">
          <label>
            <span>Período</span>
            <select
              aria-label="Período da análise"
              value={periodKey}
              onChange={event => setPeriodKey(event.target.value as PeriodKey)}
            >
              {periodOptions.map(([key, label]) =>
                <option key={key} value={key}>{label}</option>
              )}
            </select>
          </label>
          <AtlasModalClose />
        </div>
      </AtlasModalHeader>
      <AtlasModalBody className="person-dashboard-body">
        {periodKey === "custom" ? (
          <section className="person-custom-period" aria-label="Período personalizado">
            <label>
              De
              <input
                type="month"
                value={customFrom}
                max={customTo}
                onChange={event => setCustomFrom(event.target.value)}
              />
            </label>
            <label>
              Até
              <input
                type="month"
                value={customTo}
                min={customFrom}
                max={referenceMonth}
                onChange={event => setCustomTo(event.target.value)}
              />
            </label>
          </section>
        ) : null}

        {dashboard.dataQualityWarnings.length ? (
          <section className="person-data-warnings" aria-label="Qualidade dos dados">
            {dashboard.dataQualityWarnings.map(warning =>
              <p key={warning}>{warning}</p>
            )}
          </section>
        ) : null}

        <section className="person-dashboard-summary" aria-label="Resumo financeiro">
          <article className="primary">
            <span>Gasto {period.label.toLocaleLowerCase("pt-BR")}</span>
            <strong>{money(dashboard.summary.currentMonthSpent)}</strong>
            {dashboard.summary.grossSpent !==
                dashboard.summary.currentMonthSpent ? (
              <small>Bruto: {money(dashboard.summary.grossSpent)}</small>
            ) : <small>{dashboard.movements.length} movimentações</small>}
          </article>
          <article>
            <span>Média mensal</span>
            <strong>{money(dashboard.summary.monthlyAverage)}</strong>
            <label>
              <select
                aria-label="Janela da média"
                value={averageMonths}
                onChange={event =>
                  setAverageMonths(Number(event.target.value) as 3 | 6 | 12)}
              >
                <option value={3}>3 meses</option>
                <option value={6}>6 meses</option>
                <option value={12}>12 meses</option>
              </select>
            </label>
          </article>
          <article>
            <span>Variação mensal</span>
            <strong className={
              (dashboard.summary.variationPercentage ?? 0) > 0
                ? "negative"
                : "positive"
            }>
              {variationCopy}
            </strong>
            <small>{dashboard.summary.comparisonLabel}</small>
          </article>
          <article>
            <span>Próximos 30 dias</span>
            <strong>{money(dashboard.summary.upcomingCommitmentsAmount)}</strong>
            <small>
              {dashboard.summary.upcomingCommitmentsCount} compromisso(s)
            </small>
          </article>
        </section>
        {dashboard.summary.payrollDeductionAmount > 0 ? (
          <section className="person-payroll-impact" aria-label="Efeito dos descontos em folha">
            <div><span>Gasto analítico</span>
              <strong>{money(dashboard.summary.analyticalSpent)}</strong></div>
            <div><span>Desconto em folha</span>
              <strong>{money(dashboard.summary.payrollDeductionAmount)}</strong></div>
            <div><span>Saída adicional no caixa</span>
              <strong>{money(dashboard.summary.cashOutflow)}</strong></div>
            <p>
              O desconto em folha já está considerado na renda líquida e não
              reduz novamente o saldo disponível.
            </p>
          </section>
        ) : null}

        <section className="person-dashboard-section person-trend-section">
          <header>
            <div>
              <p className="eyebrow">Histórico</p>
              <h3>Evolução dos gastos</h3>
            </div>
            <span>Gasto líquido</span>
          </header>
          {dashboard.monthlyTrend.some(point => point.netSpent > 0) ? (
            <div className="person-monthly-trend" role="img" aria-label="Evolução mensal">
              <i
                className="person-average-line"
                style={{
                  bottom: `${Math.max(
                    (dashboard.summary.monthlyAverage / trendMaximum) * 100,
                    2,
                  )}%`,
                }}
              >
                <span>Média</span>
              </i>
              {dashboard.monthlyTrend.map(point => (
                <div
                  key={point.month}
                  className={point.month === referenceMonth ? "current" : ""}
                  title={`${monthLabel(point.month)}: ${money(point.netSpent)} líquido; ${money(point.grossSpent)} bruto; ${money(point.reimbursedAmount)} reembolsado`}
                >
                  <b
                    style={{
                      height: `${Math.max(
                        (point.netSpent / trendMaximum) * 100,
                        point.netSpent ? 4 : 1,
                      )}%`,
                    }}
                  />
                  <span>{monthLabel(point.month)}</span>
                  <small>{money(point.netSpent)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="person-empty-copy">
              Ainda não há gastos confirmados neste período.
            </p>
          )}
          <details className="person-annual-summary">
            <summary>Visão anual</summary>
            <dl>
              <div><dt>Total no ano</dt><dd>{money(dashboard.annualSummary.totalSpent)}</dd></div>
              <div><dt>Custo líquido</dt><dd>{money(dashboard.annualSummary.netAnnualCost)}</dd></div>
              <div><dt>Média mensal</dt><dd>{money(dashboard.annualSummary.averageMonthly)}</dd></div>
              <div>
                <dt>Mês mais caro</dt>
                <dd>{dashboard.annualSummary.mostExpensiveMonth
                  ? `${monthLabel(dashboard.annualSummary.mostExpensiveMonth.month)} · ${money(dashboard.annualSummary.mostExpensiveMonth.netSpent)}`
                  : "Sem dados"}</dd>
              </div>
              <div>
                <dt>Mês mais barato</dt>
                <dd>{dashboard.annualSummary.leastExpensiveMonth
                  ? `${monthLabel(dashboard.annualSummary.leastExpensiveMonth.month)} · ${money(dashboard.annualSummary.leastExpensiveMonth.netSpent)}`
                  : "Sem dados"}</dd>
              </div>
              <div><dt>Reembolsado</dt><dd>{money(dashboard.annualSummary.reimbursedTotal)}</dd></div>
            </dl>
          </details>
        </section>

        <div className="person-dashboard-split">
          <section className="person-dashboard-section person-category-section">
            <header>
              <div>
                <p className="eyebrow">Composição</p>
                <h3>Com o que estou gastando</h3>
              </div>
            </header>
            {dashboard.categoryBreakdown.length
              ? dashboard.categoryBreakdown.map(category => (
                <article key={category.categoryId ?? category.categoryName}>
                  <div>
                    <b>{category.categoryName}</b>
                    <span>
                      {money(category.total)} ·{" "}
                      {category.percentage.toLocaleString("pt-BR", {
                        maximumFractionDigits: 1,
                      })}%
                    </span>
                  </div>
                  <small>{category.transactionCount} lançamento(s)</small>
                  <i>
                    <b style={{ width: `${category.percentage}%` }} />
                  </i>
                </article>
              ))
              : <p className="person-empty-copy">Nenhuma categoria no período.</p>}
          </section>

          <section className="person-dashboard-section person-expense-kinds">
            <header>
              <div>
                <p className="eyebrow">Previsibilidade</p>
                <h3>Recorrentes e extraordinários</h3>
              </div>
            </header>
            <div>
              <article>
                <span>Recorrentes</span>
                <strong>{money(dashboard.recurringExpenses.total)}</strong>
                <small>{dashboard.recurringExpenses.count} item(ns)</small>
                <ul>
                  {dashboard.recurringExpenses.items.map(movement =>
                    <li key={movement.canonicalKey}>
                      <span>{movement.description}</span>
                      <b>{money(movement.amountCents)}</b>
                    </li>
                  )}
                </ul>
              </article>
              <article>
                <span>Extraordinários</span>
                <strong>{money(dashboard.extraordinaryExpenses.total)}</strong>
                <small>{dashboard.extraordinaryExpenses.count} item(ns)</small>
                <ul>
                  {dashboard.extraordinaryExpenses.items.map(movement =>
                    <li key={movement.canonicalKey}>
                      <span>{movement.description}</span>
                      <b>{money(movement.amountCents)}</b>
                    </li>
                  )}
                </ul>
              </article>
            </div>
          </section>
        </div>

        <section className="person-dashboard-section person-movements">
          <header>
            <div>
              <p className="eyebrow">Detalhamento</p>
              <h3>Movimentações</h3>
            </div>
            <span>{movements.length}</span>
          </header>
          <div className="person-movement-filters">
            <select
              aria-label="Filtrar categoria"
              value={categoryFilter}
              onChange={event => setCategoryFilter(event.target.value)}
            >
              <option value="">Todas as categorias</option>
              {categories.map(category =>
                <option key={category} value={category}>{category}</option>
              )}
            </select>
            <select
              aria-label="Filtrar tipo"
              value={kindFilter}
              onChange={event => setKindFilter(event.target.value)}
            >
              <option value="">Todos os tipos</option>
              <option value="recurring">Recorrentes</option>
              <option value="extraordinary">Extraordinários</option>
              <option value="pix">Pix</option>
              <option value="reimbursement">Reembolsos</option>
            </select>
            <select
              aria-label="Filtrar conta ou cartão"
              value={accountFilter}
              onChange={event => setAccountFilter(event.target.value)}
            >
              <option value="">Todas as contas</option>
              {accounts.map(account =>
                <option key={account} value={account}>{account}</option>
              )}
            </select>
          </div>
          {movements.length ? (
            <div className="person-movement-list">
              {movements.map(movement => (
                <Link
                  key={`${movement.canonicalKey}:${movement.id}`}
                  href={`/financeiro/movimentacoes?search=${encodeURIComponent(movement.description)}`}
                >
                  <time>{date(movement.date)}</time>
                  <span>
                    <b>{movement.description}</b>
                    <small>
                      {movement.categoryName} · {movement.accountName} ·{" "}
                      {movement.linkSource}
                    </small>
                  </span>
                  <em>{movement.displayType}</em>
                  <strong className={movement.direction}>
                    {movement.direction === "inflow" ? "+" : "-"}
                    {money(Math.abs(movement.amountCents))}
                  </strong>
                </Link>
              ))}
            </div>
          ) : (
            <p className="person-empty-copy">
              Nenhuma movimentação corresponde aos filtros.
            </p>
          )}
        </section>

        <section className="person-dashboard-section person-pix-summary">
          <header>
            <div><p className="eyebrow">Transferências</p><h3>Pix</h3></div>
            <span>
              {dashboard.pixSummary.sentCount + dashboard.pixSummary.receivedCount}
            </span>
          </header>
          <dl>
            <div><dt>Enviados</dt><dd>{money(dashboard.pixSummary.sentAmount)}</dd></div>
            <div><dt>Recebidos</dt><dd>{money(dashboard.pixSummary.receivedAmount)}</dd></div>
            <div><dt>Saldo Pix</dt><dd>{money(dashboard.pixSummary.balance)}</dd></div>
            {dashboard.pixSummary.unclassifiedCount ? (
              <div className="warning">
                <dt>Não classificados</dt>
                <dd>{money(dashboard.pixSummary.unclassifiedAmount)}</dd>
              </div>
            ) : null}
          </dl>
          {dashboard.pixSummary.movements.length ? (
            <div className="person-compact-list">
              {dashboard.pixSummary.movements.map(movement => (
                <article key={movement.canonicalKey}>
                  <span>
                    <b>{movement.description}</b>
                    <small>
                      {date(movement.date)} · {movement.displayType} ·{" "}
                      {movement.personFlowRole ?? "sem papel financeiro"}
                    </small>
                  </span>
                  <strong>{money(movement.amountCents)}</strong>
                </article>
              ))}
              <Link href={`/financeiro/movimentacoes?search=${encodeURIComponent(item.person.name)}`}>
                Ver todos
              </Link>
            </div>
          ) : <p className="person-empty-copy">Nenhum Pix no período.</p>}
        </section>

        {dashboard.reimbursementSummary.visible ? (
          <section className="person-dashboard-section person-reimbursements">
            <header>
              <div>
                <p className="eyebrow">Responsabilidades</p>
                <h3>Despesas compartilhadas e reembolsos</h3>
              </div>
            </header>
            <dl>
              <div><dt>Despesa bruta</dt><dd>{money(dashboard.reimbursementSummary.grossExpense)}</dd></div>
              <div><dt>Minha responsabilidade</dt><dd>{money(dashboard.reimbursementSummary.userResponsibility)}</dd></div>
              <div><dt>Responsabilidade da pessoa</dt><dd>{money(dashboard.reimbursementSummary.personResponsibility)}</dd></div>
              <div><dt>Reembolsado</dt><dd>{money(dashboard.reimbursementSummary.reimbursed)}</dd></div>
              <div><dt>Pendente</dt><dd>{money(dashboard.reimbursementSummary.pending)}</dd></div>
              <div><dt>Custo líquido</dt><dd>{money(dashboard.reimbursementSummary.netCost)}</dd></div>
            </dl>
          </section>
        ) : null}

        <section className="person-dashboard-section person-upcoming">
          <header>
            <div>
              <p className="eyebrow">Planejamento</p>
              <h3>Próximos compromissos</h3>
            </div>
            <button type="button" onClick={onAddCommitment}>Adicionar</button>
          </header>
          {dashboard.upcomingCommitments.length ? (
            <dl className="person-upcoming-summary">
              <div>
                <dt>Próximos 90 dias</dt>
                <dd>{money(dashboard.upcomingCommitments.reduce(
                  (sum, commitment) => sum + commitment.amountCents,
                  0,
                ))}</dd>
              </div>
              <div>
                <dt>Quantidade</dt>
                <dd>{dashboard.upcomingCommitments.length}</dd>
              </div>
              <div>
                <dt>Recorrente previsto</dt>
                <dd>{money(dashboard.upcomingCommitments
                  .filter(commitment =>
                    commitment.recurrenceType === "recurring"
                  )
                  .reduce(
                    (sum, commitment) => sum + commitment.amountCents,
                    0,
                  ))}</dd>
              </div>
            </dl>
          ) : null}
          {dashboard.upcomingCommitments.length
            ? dashboard.upcomingCommitments.map(commitment => (
              <article key={commitment.id}>
                <time>{date(commitment.dueDate)}</time>
                <span>
                  <b>{commitment.title}</b>
                  <small>
                    {commitment.categoryName} ·{" "}
                    {commitment.recurrenceType === "recurring"
                      ? "Recorrente"
                      : "Único"} ·{" "}
                    {paymentLabels[commitment.paymentMethod ?? ""] ??
                      "Forma não informada"}
                  </small>
                </span>
                <strong>{money(commitment.amountCents)}</strong>
              </article>
            ))
            : (
              <p className="person-empty-copy">
                Nenhum compromisso previsto para os próximos 90 dias.
              </p>
            )}
        </section>

        {item.person.notes
          ? <p className="person-detail-notes">{item.person.notes}</p>
          : null}
      </AtlasModalBody>
      <AtlasModalFooter>
        <button
          type="button"
          className="finance-button secondary danger-text"
          onClick={onArchive}
        >
          Arquivar
        </button>
        <span className="atlas-modal-footer-spacer" />
        <button type="button" className="finance-button secondary" onClick={onEdit}>
          Editar
        </button>
        <button type="button" className="finance-button" onClick={onAddCommitment}>
          Adicionar compromisso
        </button>
      </AtlasModalFooter>
    </div>
  );
}
