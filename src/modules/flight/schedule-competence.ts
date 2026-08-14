export type ScheduleCompetence = { year: number; month: number };

const MONTH_PARAM = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function resolveScheduleCompetence(value: string | undefined, fallback: ScheduleCompetence): ScheduleCompetence {
  const match = value?.match(MONTH_PARAM);
  return match ? { year: Number(match[1]), month: Number(match[2]) } : fallback;
}

export function formatScheduleCompetence({ year, month }: ScheduleCompetence) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftScheduleCompetence({ year, month }: ScheduleCompetence, delta: number): ScheduleCompetence {
  const index = year * 12 + month - 1 + delta;
  return { year: Math.floor(index / 12), month: index % 12 + 1 };
}
