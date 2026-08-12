/**
 * ストップウォッチ（0から数え上げるだけの、長さの決まっていないタイマー）の状態機械。
 * `timer-state.ts`/`countdown-state.ts` と同じ設計（絶対時刻ベース、Clock 注入、
 * 副作用ゼロの純粋関数）を、上限を持たない形にしたもの。
 */
export type StopwatchStatus = "idle" | "running" | "paused";

export interface StopwatchState {
  readonly status: StopwatchStatus;
  readonly startedAt: number | null;
  readonly accumulatedPauseMs: number;
  readonly pausedAt: number | null;
}

export function createIdleStopwatch(): StopwatchState {
  return { status: "idle", startedAt: null, accumulatedPauseMs: 0, pausedAt: null };
}

export function startStopwatch(s: StopwatchState, now: number): StopwatchState {
  if (s.status === "running") return s;
  return { ...s, status: "running", startedAt: now, accumulatedPauseMs: 0, pausedAt: null };
}

export function pauseStopwatch(s: StopwatchState, now: number): StopwatchState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", pausedAt: now };
}

export function resumeStopwatch(s: StopwatchState, now: number): StopwatchState {
  if (s.status !== "paused" || s.pausedAt === null) return s;
  return { ...s, status: "running", accumulatedPauseMs: s.accumulatedPauseMs + Math.max(0, now - s.pausedAt), pausedAt: null };
}

export function resetStopwatch(): StopwatchState {
  return createIdleStopwatch();
}

/** now - startedAt - accumulatedPauseMs。setInterval の回数は数えない（docs/CLAUDE.md）。 */
export function stopwatchElapsedMs(s: StopwatchState, now: number): number {
  if (s.startedAt === null) return 0;
  const pauseMs = s.pausedAt !== null ? s.accumulatedPauseMs + Math.max(0, now - s.pausedAt) : s.accumulatedPauseMs;
  return Math.max(0, now - s.startedAt - pauseMs);
}

export function isStopwatchRunning(s: StopwatchState): boolean {
  return s.status === "running";
}

export function isStopwatchPaused(s: StopwatchState): boolean {
  return s.status === "paused";
}
