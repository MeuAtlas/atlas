export type HalfMonth = "FIRST_HALF" | "SECOND_HALF";
export type DiemPaymentStatus = "ESTIMATED" | "CLOSED" | "PARTIAL" | "UNKNOWN";
export function halfMonthFor(date: string): HalfMonth { return Number(date.slice(8, 10)) <= 15 ? "FIRST_HALF" : "SECOND_HALF"; }
export function paymentDateForEntitlement(date: string) { const [year, month, day] = date.split("-").map(Number); if (day <= 15) return `${year}-${String(month).padStart(2, "0")}-25`; const next = new Date(Date.UTC(year, month, 10)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-10`; }
export function paymentCycleForEntitlement(date: string) { return `${halfMonthFor(date)}:${paymentDateForEntitlement(date)}`; }
export function diemCycleStatus(items: readonly { eligibilityStatus: string; amountMinorUnits: number | null }[]): DiemPaymentStatus { if (!items.length) return "UNKNOWN"; return items.some(item => item.eligibilityStatus === "UNKNOWN" || (item.eligibilityStatus === "ELIGIBLE" && item.amountMinorUnits === null)) ? "PARTIAL" : "ESTIMATED"; }
