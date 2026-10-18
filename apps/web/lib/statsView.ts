import {
  currentStreakDays,
  summarizeDay,
  summarizeLastDays,
  totalCompletedPomodoros,
  type DaySummary,
  type OffsetMinutesAt,
  type SessionRecord,
} from "@kairos/core";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface WeeklyFocusDay extends DaySummary {
  readonly date: string;
  readonly label: string;
  readonly heightRatio: number;
  readonly focusTime: string;
}

export interface StatsView {
  readonly isEmpty: boolean;
  readonly today: DaySummary & { readonly focusTime: string };
  readonly week: readonly WeeklyFocusDay[];
  readonly streakDays: number;
  readonly totalPomodoros: number;
}

export function formatFocusTime(focusMs: number): string {
  const totalMinutes = Math.floor(focusMs / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
}

/** Calendar labels use local day numbers, just like the core aggregates, to survive DST. */
export function buildStatsView(
  records: readonly SessionRecord[],
  now: number,
  offsetMinutesAt: OffsetMinutesAt,
): StatsView {
  const today = summarizeDay(records, now, offsetMinutesAt);
  const week = summarizeLastDays(records, now, 7, offsetMinutesAt);
  const maxFocusMs = Math.max(...week.map((day) => day.focusMs));
  const todayNumber = Math.floor((now + offsetMinutesAt(now) * MINUTE_MS) / DAY_MS);

  return {
    isEmpty: records.length === 0,
    today: { ...today, focusTime: formatFocusTime(today.focusMs) },
    week: week.map((day, index) => {
      const date = new Date((todayNumber - 6 + index) * DAY_MS);
      return {
        ...day,
        date: date.toISOString().slice(0, 10),
        label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
        heightRatio: maxFocusMs === 0 ? 0 : day.focusMs / maxFocusMs,
        focusTime: formatFocusTime(day.focusMs),
      };
    }),
    streakDays: currentStreakDays(records, now, offsetMinutesAt),
    totalPomodoros: totalCompletedPomodoros(records),
  };
}
