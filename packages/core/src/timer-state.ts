import type { PomodoroPreset } from "./preset";

/**
 * docs/02_SPEC.md §4 の状態機械。
 *
 *               start()
 *    [Idle] ─────────────► [Focus:Running]
 *       ▲                    │  │  ▲
 *       │            pause() │  │  │ resume()
 *       │                    ▼  │  │
 *       │              [Focus:Paused]
 *       │                    │
 *       │        complete() / skip()
 *       │                    ▼
 *       │           [Break:Running] ──pause()──► [Break:Paused]
 *       │                    │
 *       │        complete() / skip()
 *       │                    ▼
 *       │        ラウンド未達 → [Focus:Running]
 *       └── reset() ── 全ラウンド完了 → [Completed] → [Idle]
 */
export type SessionPhase = "idle" | "focus" | "shortBreak" | "longBreak" | "completed";

/** タイマーの実行時状態。phaseStartedAt は「絶対時刻」であることが重要（epoch ms）。 */
export interface TimerState {
  readonly phase: SessionPhase;
  readonly preset: PomodoroPreset;
  readonly phaseStartedAt: number | null;
  readonly accumulatedPauseMs: number;
  readonly pausedAt: number | null;
  readonly currentRound: number; // 1-indexed
  readonly totalRounds: number;
  readonly taskHeadline: string;
  readonly sessionSeed: number; // 音の再現性のための乱数シード
}

export interface CreateIdleStateOptions {
  readonly totalRounds?: number;
  readonly taskHeadline?: string;
  readonly sessionSeed?: number;
}

export function createIdleState(
  preset: PomodoroPreset,
  now: number,
  opts: CreateIdleStateOptions = {},
): TimerState {
  return {
    phase: "idle",
    preset,
    phaseStartedAt: null,
    accumulatedPauseMs: 0,
    pausedAt: null,
    currentRound: 1,
    totalRounds: opts.totalRounds ?? 4,
    taskHeadline: opts.taskHeadline ?? "",
    sessionSeed: opts.sessionSeed ?? now,
  };
}

export function phaseDurationMs(s: TimerState): number {
  switch (s.phase) {
    case "focus":
      return s.preset.focusMs;
    case "shortBreak":
      return s.preset.shortBreakMs;
    case "longBreak":
      return s.preset.longBreakMs;
    default:
      return 0;
  }
}

/** now - phaseStartedAt - accumulatedPauseMs。setInterval の回数は数えない。 */
export function elapsedMs(s: TimerState, now: number): number {
  if (s.phaseStartedAt === null) return 0;
  const pauseMs =
    s.pausedAt !== null ? s.accumulatedPauseMs + Math.max(0, now - s.pausedAt) : s.accumulatedPauseMs;
  return Math.max(0, now - s.phaseStartedAt - pauseMs);
}

export function remainingMs(s: TimerState, now: number): number {
  return Math.max(0, phaseDurationMs(s) - elapsedMs(s, now));
}

/** 0.0..1.0 の正規化進捗。音エンジンへはこの t を渡す（秒数は渡さない）。 */
export function progress(s: TimerState, now: number): number {
  const duration = phaseDurationMs(s);
  if (duration <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs(s, now) / duration));
}

export function isActivePhase(phase: SessionPhase): phase is "focus" | "shortBreak" | "longBreak" {
  return phase === "focus" || phase === "shortBreak" || phase === "longBreak";
}

export function isRunning(s: TimerState): boolean {
  return s.phaseStartedAt !== null && s.pausedAt === null && isActivePhase(s.phase);
}

export function isPaused(s: TimerState): boolean {
  return s.pausedAt !== null;
}

export function isPhaseComplete(s: TimerState, now: number): boolean {
  return isRunning(s) && elapsedMs(s, now) >= phaseDurationMs(s);
}
