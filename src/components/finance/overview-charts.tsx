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
}: {
  data: AccountMovementDailyPoint[];
}) {
  const hidden = useValuesHidden();
  const [mode, setMode] = useState<"cumulative" | "daily">("cumulative");
  if (hidden) return <HiddenChart />;
  const inflowKey =
    mode === "cumulative" ? "cumulativeInflow" : "dailyInflow";
  const outflowKey =
    mode === "cumulative" ? "cumulativeOutflow" : "dailyOutflow";
  const lastLabel = data.at(-1)?.label;
  return (
    <div className="account-movement-chart-shell">
      <div className="account-movement-chart-head">
        <div className="account-movement-legend" aria-label="Legenda do gráfico">
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
        aria-label={`Entradas e saídas da conta no mês, visualização ${mode === "cumulative" ? "acumulada" : "diária"}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--atlas-chart-axis)", fontSize: 10 }}
              tickFormatter={(label) =>
                ["01", "05", "10", "15", "20", "25", lastLabel].includes(
                  String(label),
                )
                  ? String(label)
                  : ""
              }
              interval={0}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={66}
              tick={{ fill: "var(--atlas-chart-axis)", fontSize: 10 }}
              tickFormatter={compactCurrency}
            />
            <Tooltip
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as
                  | AccountMovementDailyPoint
                  | undefined;
                if (!active || !point) return null;
                return (
                  <div className="account-movement-tooltip">
                    <b>{formatDate(point.date)}</b>
                    <span>Entradas do dia <strong>{formatCurrency(point.dailyInflow)}</strong></span>
                    <span>Saídas do dia <strong>{formatCurrency(point.dailyOutflow)}</strong></span>
                    <span>Entradas acumuladas <strong>{formatCurrency(point.cumulativeInflow)}</strong></span>
                    <span>Saídas acumuladas <strong>{formatCurrency(point.cumulativeOutflow)}</strong></span>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey={inflowKey}
              name="Entradas"
              stroke="var(--atlas-success)"
              strokeWidth={2.5}
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
            tick={{ fill: "var(--atlas-chart-axis)", fontSize: 11 }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--atlas-chart-axis)", fontSize: 10 }}
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
          <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
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
