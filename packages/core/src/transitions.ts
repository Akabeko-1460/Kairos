import { phaseDurationMs, type SessionPhase, type TimerState } from "./timer-state";

function isLongBreakRound(round: number, roundsBeforeLongBreak: number): boolean {
  return round % roundsBeforeLongBreak === 0;
}

/** Idle または Completed から最初の Focus フェーズを開始する。 */
export function start(state: TimerState, now: number): TimerState {
  if (state.phase !== "idle" && state.phase !== "completed") return state;
  return {
    ...state,
    phase: "focus",
    phaseStartedAt: now,
    accumulatedPauseMs: 0,
    pausedAt: null,
    currentRound: 1,
    sessionSeed: now,
  };
}

/** 一時停止中は音もフェードアウトして停止する（docs/02_SPEC.md §4）。 */
export function pause(state: TimerState, now: number): TimerState {
  if (state.pausedAt !== null || state.phaseStartedAt === null) return state;
  return { ...state, pausedAt: now };
}

export function resume(state: TimerState, now: number): TimerState {
  if (state.pausedAt === null) return state;
  const pausedDuration = Math.max(0, now - state.pausedAt);
  return {
    ...state,
    pausedAt: null,
    accumulatedPauseMs: state.accumulatedPauseMs + pausedDuration,
  };
}

interface NextPhase {
  readonly phase: SessionPhase;
  readonly nextRound: number;
}

function nextPhaseFrom(state: TimerState): NextPhase {
  const { phase, currentRound, totalRounds, preset } = state;
  if (phase === "focus") {
    const long = isLongBreakRound(currentRound, preset.roundsBeforeLongBreak);
    return { phase: long ? "longBreak" : "shortBreak", nextRound: currentRound };
  }
  if (phase === "shortBreak" || phase === "longBreak") {
    if (currentRound >= totalRounds) {
      return { phase: "completed", nextRound: currentRound };
    }
    return { phase: "focus", nextRound: currentRound + 1 };
  }
  return { phase: state.phase, nextRound: currentRound };
}

/**
 * フェーズ完了 or 手動スキップによる次フェーズへの遷移。
 * `now` はこの遷移が実際に起きた絶対時刻（超過分を差し引いた時刻を渡すのは呼び出し側の責務、`syncToNow` 参照）。
 */
export function advance(state: TimerState, now: number): TimerState {
  if (state.phase !== "focus" && state.phase !== "shortBreak" && state.phase !== "longBreak") {
    return state;
  }
  const { phase, nextRound } = nextPhaseFrom(state);
  if (phase === "completed") {
    return {
      ...state,
      phase: "completed",
      phaseStartedAt: null,
      pausedAt: null,
      accumulatedPauseMs: 0,
    };
  }
  return {
    ...state,
    phase,
    currentRound: nextRound,
    phaseStartedAt: now,
    accumulatedPauseMs: 0,
    pausedAt: null,
  };
}

/** UI 上は "スキップ" だが、遷移ロジックは自然完了と同じ。 */
export const skip = advance;

export function reset(state: TimerState, now: number): TimerState {
  return {
    ...state,
    phase: "idle",
    phaseStartedAt: null,
    accumulatedPauseMs: 0,
    pausedAt: null,
    currentRound: 1,
    sessionSeed: now,
  };
}

export function setTaskHeadline(state: TimerState, taskHeadline: string): TimerState {
  return { ...state, taskHeadline };
}

/** 停止中（idle/completed）のみプリセット切り替えを許可する。 */
export function changePreset(state: TimerState, preset: TimerState["preset"]): TimerState {
  if (state.phase !== "idle" && state.phase !== "completed") return state;
  return { ...state, preset };
}

export function setTotalRounds(state: TimerState, totalRounds: number): TimerState {
  if (totalRounds < 1) return state;
  return { ...state, totalRounds };
}

/**
 * Page Visibility 復帰時などに呼ぶ。フェーズ長を超過していれば、超過分を正しく引き継ぎながら
 * 必要な回数だけ連続で advance する（複数フェーズをまたいで長時間放置されていた場合に対応）。
 */
export function syncToNow(state: TimerState, now: number): TimerState {
  let next = state;
  let guard = 0;
  while (
    next.phaseStartedAt !== null &&
    next.pausedAt === null &&
    (next.phase === "focus" || next.phase === "shortBreak" || next.phase === "longBreak") &&
    now - next.phaseStartedAt - next.accumulatedPauseMs >= phaseDurationMs(next) &&
    guard < 10_000 // 異常な入力によるフリーズを防ぐガード
  ) {
    const overshootMs = now - next.phaseStartedAt - next.accumulatedPauseMs - phaseDurationMs(next);
    next = advance(next, now - overshootMs);
    guard += 1;
  }
  return next;
}
