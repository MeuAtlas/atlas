"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialTransaction } from "@/modules/finance/types";

type ChartRow = {
  date: string;
  entradas: number;
  saidas: number;
  faturas: number;
  transferencias: number;
};

export function FinanceChart({
  transactions,
}: {
  transactions: FinancialTransaction[];
}) {
  const grouped = new Map<string, ChartRow>();

  for (const item of transactions
    .filter((transaction) => transaction.status === "realized")
    .slice()
    .reverse()) {
    const key = item.competence_date.slice(5);
    const row = grouped.get(key) ?? {
      date: key,
      entradas: 0,
      saidas: 0,
      faturas: 0,
      transferencias: 0,
    };

    if (item.transaction_role === "invoice_payment") {
      row.faturas += Number(item.amount);
    } else if (item.transaction_role === "transfer") {
      row.transferencias += Number(item.amount);
    } else if (item.transaction_type === "income") {
      row.entradas += Number(item.amount);
    } else if (item.transaction_type === "expense") {
      row.saidas += Number(item.amount);
    }
    grouped.set(key, row);
  }

  const data = [...grouped.values()].slice(-12);
  if (!data.length) {
    return (
      <div className="finance-chart-empty">
        O gráfico aparecerá após sua primeira movimentação realizada.
      </div>
    );
  }

  return (
    <div className="finance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="income" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#37d6bd" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#37d6bd" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--atlas-chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--atlas-chart-axis)", fontSize: 12 }}
          />
          <YAxis hide />
          <Tooltip
            formatter={(value) =>
              `R$ ${Number(value).toLocaleString("pt-BR")}`
            }
            contentStyle={{
              background: "var(--atlas-tooltip-background)",
              border: "1px solid var(--atlas-tooltip-border)",
              borderRadius: 12,
              color: "var(--atlas-tooltip-text)",
              boxShadow: "var(--atlas-shadow)",
            }}
          />
          <Area
            type="monotone"
            dataKey="entradas"
            name="Entradas bancárias"
            stroke="#37d6bd"
            fill="url(#income)"
          />
          <Area
            type="monotone"
            dataKey="saidas"
            name="Saídas bancárias"
            stroke="#ff718b"
            fill="transparent"
          />
          <Area
            type="monotone"
            dataKey="faturas"
            name="Pagamentos de fatura"
            stroke="#5f7cff"
            fill="transparent"
          />
          <Area
            type="monotone"
            dataKey="transferencias"
            name="Transferências"
            stroke="#c49aff"
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
