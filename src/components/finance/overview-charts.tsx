"use client";

import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useValuesHidden } from "./value-visibility";
import type {
  CashFlowPoint,
} from "@/modules/finance/dashboard";
import type { AccountMovementDailyPoint } from "@/modules/finance/account-movement";
import { formatCurrency, formatDate } from "@/modules/finance/format";

const compactCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

function HiddenChart() {
  return (
    <div className="overview-chart-private" role="status">
      Valores e gráficos ocultos
    </div>
  );
}

export function AccountMovementChart({
  data,
  openingBalance,
}: {
  data: AccountMovementDailyPoint[];
  openingBalance?: number;
}) {
  const hidden = useValuesHidden();
  const [mode, setMode] = useState<"cumulative" | "daily">("cumulative");
  if (hidden) return <HiddenChart />;
  const inflowKey =
    mode === "cumulative" ? "cumulativeInflow" : "dailyInflow";
  const outflowKey =
    mode === "cumulative" ? "cumulativeOutflow" : "dailyOutflow";
  const showsCashBalance = typeof openingBalance === "number";
  const resultKey = showsCashBalance
    ? "cashBalance"
    : mode === "cumulative" ? "cumulativeResult" : "dailyResult";
  const movementData = data.map((point) => ({
    ...point,
    dailyResult: point.dailyInflow - point.dailyOutflow,
    cumulativeResult: point.cumulativeInflow - point.cumulativeOutflow,
    cashBalance: (openingBalance ?? 0) + point.cumulativeInflow - point.cumulativeOutflow,
  }));
  const chartData = showsCashBalance && data.length ? [
    {
      ...data[0],
      label: "Início",
      dailyInflow: 0,
      dailyOutflow: 0,
      cumulativeInflow: 0,
      cumulativeOutflow: 0,
      dailyResult: 0,
      cumulativeResult: 0,
      cashBalance: openingBalance,
      openingPoint: true,
    },
    ...movementData,
  ] : movementData;
  const lastLabel = data.at(-1)?.label;
  const visibleLabels = showsCashBalance
    ? ["Início", "05", "10", "15", "20", "25", lastLabel]
    : ["01", "05", "10", "15", "20", "25", lastLabel];
  return (
    <div className="account-movement-chart-shell">
      <div className="account-movement-chart-head">
        <div className="account-movement-legend" aria-label="Legenda do gráfico">
          {showsCashBalance ? <span className="balance"><i />Saldo</span> : null}
          <span className="inflow"><i />Entradas</span>
          <span className="outflow"><i />Saídas</span>
        </div>
        <div className="account-movement-mode" aria-label="Visualização do gráfico">
          <button
            type="button"
            className={mode === "cumulative" ? "active" : undefined}
            onClick={() => setMode("cumulative")}
            aria-pressed={mode === "cumulative"}
          >
            Acumulado
          </button>
          <button
            type="button"
            className={mode === "daily" ? "active" : undefined}
            onClick={() => setMode("daily")}
            aria-pressed={mode === "daily"}
          >
            Por dia
          </button>
        </div>
      </div>
      <div
        className="overview-balance-chart"
        role="img"
        aria-label={`Entradas, saídas e ${showsCashBalance ? "saldo em caixa" : "resultado"} da conta no mês, visualização ${mode === "cumulative" ? "acumulada" : "diária"}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }}
              tickFormatter={(label) =>
                visibleLabels.includes(String(label))
                  ? String(label)
                  : ""
              }
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={66}
              tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }}
              tickFormatter={compactCurrency}
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  | (AccountMovementDailyPoint & { cashBalance?: number; openingPoint?: boolean })
                  | undefined;
                if (!active || !point) return null;
                if (point.openingPoint) {
                  return (
                    <div className="account-movement-tooltip">
                      <b>Saldo inicial</b>
                      <span>Saldo em caixa <strong>{formatCurrency(point.cashBalance ?? 0)}</strong></span>
                    </div>
                  );
                }
                return (
                  <div className="account-movement-tooltip">
                    <b>{formatDate(point.date)}</b>
                    <span>Entradas do dia <strong>{formatCurrency(point.dailyInflow)}</strong></span>
                    <span>Saídas do dia <strong>{formatCurrency(point.dailyOutflow)}</strong></span>
                    <span>Entradas acumuladas <strong>{formatCurrency(point.cumulativeInflow)}</strong></span>
                    <span>Saídas acumuladas <strong>{formatCurrency(point.cumulativeOutflow)}</strong></span>
                    {showsCashBalance ? <span>Saldo em caixa <strong>{formatCurrency(point.cashBalance ?? 0)}</strong></span> : null}
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey={inflowKey}
              name="Entradas"
              stroke="var(--atlas-success)"
              strokeWidth={2.3}
              dot={false}
              activeDot={{ r: 4, fill: "var(--atlas-success)" }}
            />
            <Line
              type="monotone"
              dataKey={outflowKey}
              name="Saídas"
              stroke="var(--atlas-error)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "var(--atlas-error)" }}
            />
            <Line
              type="monotone"
              dataKey={resultKey}
              name={showsCashBalance ? "Saldo em caixa" : "Resultado"}
              stroke="var(--atlas-blue)"
              strokeWidth={3.4}
              dot={false}
              activeDot={{ r: 4, fill: "var(--atlas-blue)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function CashFlowOverviewChart({ data }: { data: CashFlowPoint[] }) {
  const hidden = useValuesHidden();
  if (hidden) return <HiddenChart />;
  if (!data.length) {
    return <div className="overview-chart-empty">Sem movimentações no período.</div>;
  }
  return (
    <div
      className="overview-cash-chart"
      role="img"
      aria-label="Fluxo financeiro dos últimos seis meses com receitas, despesas e saldo acumulado"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }}
            tickFormatter={compactCurrency}
          />
          <Tooltip
            formatter={(value) => compactCurrency(Number(value))}
            contentStyle={{
              background: "var(--atlas-tooltip-background)",
              border: "1px solid var(--atlas-tooltip-border)",
              borderRadius: 12,
              color: "var(--atlas-tooltip-text)",
              boxShadow: "var(--atlas-shadow)",
            }}
          />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
          <Bar
            dataKey="income"
            name="Receitas"
            fill="#35c98f"
            radius={[3, 3, 0, 0]}
          />
          <Bar
            dataKey="expenses"
            name="Despesas"
            fill="#ff6578"
            radius={[3, 3, 0, 0]}
          />
          <Line
            type="monotone"
            dataKey="balance"
            name="Saldo acumulado"
            stroke="var(--atlas-tab-active)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--atlas-tab-active)" }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
