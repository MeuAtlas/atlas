export interface BillingCycle {
  cycleStart: string;
  cycleEnd: string;
  closingDate: string;
  dueDate: string;
  previousCycleStart: string;
  previousCycleEnd: string;
  previousClosingDate: string;
  previousDueDate: string;
  nextCycleStart: string;
  nextCycleEnd: string;
  status: "open";
  daysUntilClosing: number;
  referenceMonth: string;
}

const DAY_MS = 86_400_000;
const iso = (date: Date) => date.toISOString().slice(0, 10);
const utcDate = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month, day));
const daysInMonth = (year: number, month: number) =>
  utcDate(year, month + 1, 0).getUTCDate();
const validDay = (year: number, month: number, day: number) =>
  Math.min(day, daysInMonth(year, month));
const atDay = (year: number, month: number, day: number) =>
  utcDate(year, month, validDay(year, month, day));
const addMonths = (date: Date, amount: number, day: number) =>
  atDay(date.getUTCFullYear(), date.getUTCMonth() + amount, day);

function calendarDateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return utcDate(value("year"), value("month") - 1, value("day"));
}

function dueForClosing(closing: Date, closingDay: number, dueDay: number) {
  return addMonths(closing, dueDay <= closingDay ? 1 : 0, dueDay);
}

export function getCurrentCreditCardBillingCycle({
  closingDay,
  dueDay,
  referenceDate,
  timezone = "America/Sao_Paulo",
}: {
  closingDay: number;
  dueDay: number;
  referenceDate: Date;
  timezone?: string;
}): BillingCycle {
  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31)
    throw new Error("closingDay must be between 1 and 31");
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)
    throw new Error("dueDay must be between 1 and 31");

  const reference = calendarDateInTimeZone(referenceDate, timezone);
  let closing = atDay(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    closingDay,
  );
  if (reference > closing) closing = addMonths(closing, 1, closingDay);

  const previousClosing = addMonths(closing, -1, closingDay);
  const beforePreviousClosing = addMonths(closing, -2, closingDay);
  const nextClosing = addMonths(closing, 1, closingDay);
  const cycleStart = new Date(previousClosing.valueOf() + DAY_MS);
  const previousCycleStart = new Date(
    beforePreviousClosing.valueOf() + DAY_MS,
  );
  const nextCycleStart = new Date(closing.valueOf() + DAY_MS);
  const due = dueForClosing(closing, closingDay, dueDay);
  const previousDue = dueForClosing(previousClosing, closingDay, dueDay);

  return {
    cycleStart: iso(cycleStart),
    cycleEnd: iso(closing),
    closingDate: iso(closing),
    dueDate: iso(due),
    previousCycleStart: iso(previousCycleStart),
    previousCycleEnd: iso(previousClosing),
    previousClosingDate: iso(previousClosing),
    previousDueDate: iso(previousDue),
    nextCycleStart: iso(nextCycleStart),
    nextCycleEnd: iso(nextClosing),
    status: "open",
    daysUntilClosing: Math.max(
      0,
      Math.ceil((closing.valueOf() - reference.valueOf()) / DAY_MS),
    ),
    referenceMonth: iso(closing).slice(0, 7),
  };
}

export const getCurrentBillingCycle = getCurrentCreditCardBillingCycle;
