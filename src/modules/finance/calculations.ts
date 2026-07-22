import type { FinanceSummary, FinancialAccount, FinancialTransaction } from "./types";

const money = (value: number | string | null | undefined) => Number(value ?? 0);
export function isRealized(t: FinancialTransaction) { return t.status === "realized"; }
export function isIncome(t: FinancialTransaction) { return t.transaction_type === "income" || t.transaction_type === "refund" || t.transaction_type === "reversal"; }
export function isExpense(t: FinancialTransaction) { return t.transaction_type === "expense"; }
export function summarizeFinance(accounts: FinancialAccount[], transactions: FinancialTransaction[], today = new Date()): FinanceSummary {
  const available = accounts.filter(a=>a.status==="active").reduce((sum,a)=>sum+money(a.current_balance),0);
  const currentMonth = today.toISOString().slice(0,7);
  const monthly = transactions.filter(t=>t.competence_date.startsWith(currentMonth) && t.transaction_type!=="transfer" && t.status!=="cancelled");
  const income = monthly.filter(t=>isRealized(t)&&isIncome(t)).reduce((s,t)=>s+money(t.amount),0);
  const expenses = monthly.filter(t=>isRealized(t)&&isExpense(t)).reduce((s,t)=>s+money(t.amount),0);
  const receivable = monthly.filter(t=>!isRealized(t)&&isIncome(t)).reduce((s,t)=>s+money(t.amount),0);
  const payable = monthly.filter(t=>!isRealized(t)&&isExpense(t)).reduce((s,t)=>s+money(t.amount),0);
  const todayKey=today.toISOString().slice(0,10);
  const overdue=transactions.filter(t=>t.due_date && t.due_date<todayKey && ["forecast","pending","partial","overdue"].includes(t.status)).reduce((s,t)=>s+money(t.amount),0);
  return {available,income,expenses,receivable,payable,overdue,monthlyResult:income-expenses,projected:available+receivable-payable};
}
