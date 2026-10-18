import type { SessionPhase } from "./timer-state";

export interface SessionRecord {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly phase: SessionPhase;
  readonly plannedMs: number;
  readonly actualMs: number;
  readonly completed: boolean;
  readonly taskHeadline: string;
  readonly soundPackId: string;
}

/** UTC から東向きを正とする分単位のオフセット（日本時間は +540）。 */
export type OffsetMinutesAt = (ms: number) => number;

export interface DaySummary {
  readonly focusMs: number;
  readonly completedPomodoros: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function localDayNumber(ms: number, offsetMinutesAt: OffsetMinutesAt): number {
  return Math.floor((ms + offsetMinutesAt(ms) * MINUTE_MS) / DAY_MS);
}

function summarizeByDay(
  records: readonly SessionRecord[],
  offsetMinutesAt: OffsetMinutesAt,
): Map<number, DaySummary> {
  const summaries = new Map<number, DaySummary>();
  for (const record of records) {
    if (record.phase !== "focus") continue;

    const day = localDayNumber(record.endedAt, offsetMinutesAt);
    const previous = summaries.get(day);
    summaries.set(day, {
      focusMs: (previous?.focusMs ?? 0) + record.actualMs,
      completedPomodoros: (previous?.completedPomodoros ?? 0) + Number(record.completed),
    });
  }
  return summaries;
}

/** dayStartMs が属するローカル日の集計。日をまたぐ記録は終了日に含める。 */
export function summarizeDay(
  records: readonly SessionRecord[],
  dayStartMs: number,
  offsetMinutesAt: OffsetMinutesAt,
): DaySummary {
  return summarizeByDay(records, offsetMinutesAt).get(localDayNumber(dayStartMs, offsetMinutesAt))
    ?? { focusMs: 0, completedPomodoros: 0 };
}

/** 今日を含む days 日分の集計を古い日から返す。記録のない日はゼロ。 */
export function summarizeLastDays(
  records: readonly SessionRecord[],
  now: number,
  days: number,
  offsetMinutesAt: OffsetMinutesAt,
): DaySummary[] {
  if (!Number.isSafeInteger(days) || days < 0) {
    throw new RangeError("days must be a non-negative safe integer");
  }
  const summaries = summarizeByDay(records, offsetMinutesAt);
  const today = localDayNumber(now, offsetMinutesAt);
  // UTC 時刻を24時間ずつ戻すと夏時間の切り替えで日が重複・欠落するため、日番号を使う。
  return Array.from({ length: days }, (_, index) => (
    summaries.get(today - days + 1 + index) ?? { focusMs: 0, completedPomodoros: 0 }
  ));
}

/** 今日が未完了なら昨日から、完了した focus がある日の連続数を数える。 */
export function currentStreakDays(
  records: readonly SessionRecord[],
  now: number,
  offsetMinutesAt: OffsetMinutesAt,
): number {
  const summaries = summarizeByDay(records, offsetMinutesAt);
  let day = localDayNumber(now, offsetMinutesAt);
  if (!summaries.get(day)?.completedPomodoros) day -= 1;

  let streak = 0;
  while ((summaries.get(day)?.completedPomodoros ?? 0) > 0) {
    streak += 1;
    day -= 1;
  }
  return streak;
}

export function totalCompletedPomodoros(records: readonly SessionRecord[]): number {
  return records.reduce((total, record) => (
    total + Number(record.phase === "focus" && record.completed)
  ), 0);
}
