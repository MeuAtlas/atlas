export type CalendarEvent = { type: string; code: string; label: string | null; start: string | null; end: string | null; location: string | null };
export type CalendarDay = { date: string; events: CalendarEvent[] };
