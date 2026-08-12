/**
 * 「普通のタイマー」（Pomodoro のようなラウンド/休憩を持たない、単発のカウントダウン）の
 * 状態機械。`timer-state.ts` と同じ設計（絶対時刻ベース、Clock 注入、副作用ゼロの純粋関数）を
 * ラウンド/休憩の概念なしで単純化したもの。
 */
export type CountdownStatus = "idle" | "running" | "paused" | "completed";

export interface CountdownState {
  readonly status: CountdownStatus;
  readonly durationMs: number;
  readonly startedAt: number | null;
  readonly accumulatedPauseMs: number;
  readonly pausedAt: number | null;
}

export function createIdleCountdown(durationMs: number): CountdownState {
  return {
    status: "idle",
    durationMs: Math.max(0, durationMs),
    startedAt: null,
    accumulatedPauseMs: 0,
    pausedAt: null,
  };
}

export function startCountdown(s: CountdownState, now: number): CountdownState {
  if (s.status === "running") return s;
  return { ...s, status: "running", startedAt: now, accumulatedPauseMs: 0, pausedAt: null };
}

export function pauseCountdown(s: CountdownState, now: number): CountdownState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", pausedAt: now };
}

export function resumeCountdown(s: CountdownState, now: number): CountdownState {
  if (s.status !== "paused" || s.pausedAt === null) return s;
  return { ...s, status: "running", accumulatedPauseMs: s.accumulatedPauseMs + Math.max(0, now - s.pausedAt), pausedAt: null };
}

/** 同じ durationMs のまま idle に戻す。durationMs を変えたい場合は createIdleCountdown をやり直す。 */
export function resetCountdown(s: CountdownState): CountdownState {
  return createIdleCountdown(s.durationMs);
}

export function setCountdownDuration(s: CountdownState, durationMs: number): CountdownState {
  return { ...s, durationMs: Math.max(0, durationMs) };
}

/** now - startedAt - accumulatedPauseMs。setInterval の回数は数えない（docs/CLAUDE.md）。 */
export function countdownElapsedMs(s: CountdownState, now: number): number {
  if (s.startedAt === null) return 0;
  const pauseMs = s.pausedAt !== null ? s.accumulatedPauseMs + Math.max(0, now - s.pausedAt) : s.accumulatedPauseMs;
  return Math.max(0, now - s.startedAt - pauseMs);
}

export function countdownRemainingMs(s: CountdownState, now: number): number {
  return Math.max(0, s.durationMs - countdownElapsedMs(s, now));
}

/** 0.0..1.0 の正規化進捗。 */
export function countdownProgress(s: CountdownState, now: number): number {
  if (s.durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, countdownElapsedMs(s, now) / s.durationMs));
}

/** 実行中かつ残り時間が尽きているか。UI 側はこれを見て completed へ遷移させる。 */
export function isCountdownFinished(s: CountdownState, now: number): boolean {
  return s.status === "running" && countdownElapsedMs(s, now) >= s.durationMs;
}

/** isCountdownFinished を確定させ、completed へ遷移させる純粋関数。変化が無ければ同一参照を返す。 */
export function syncCountdownToNow(s: CountdownState, now: number): CountdownState {
  if (isCountdownFinished(s, now)) return { ...s, status: "completed" };
  return s;
}

export function isCountdownRunning(s: CountdownState): boolean {
  return s.status === "running";
}

export function isCountdownPaused(s: CountdownState): boolean {
  return s.status === "paused";
}
