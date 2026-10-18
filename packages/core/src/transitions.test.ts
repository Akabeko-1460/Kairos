import { describe, expect, it } from "vitest";
import { CLASSIC_PRESET } from "./preset";
import { createIdleState, isPaused, isRunning, remainingMs, type TimerState } from "./timer-state";
import { advance, pause, reset, resume, setAutoContinue, skip, start, syncToNow, syncToNowSteps } from "./transitions";

const T0 = 1_000_000;

function runFullCycle(totalRounds: number): TimerState["phase"][] {
  let s = createIdleState(CLASSIC_PRESET, T0, { totalRounds });
  s = start(s, T0);
  const phases: TimerState["phase"][] = [s.phase];
  let t = T0;
  // 安全弁: ラウンド数 * 2 を大きく超えたら異常
  for (let i = 0; i < totalRounds * 2 + 2 && s.phase !== "completed"; i++) {
    t += 1;
    s = advance(s, t);
    phases.push(s.phase);
  }
  return phases;
}

describe("transitions", () => {
  describe("syncToNowSteps", () => {
    it("returns every transition at its actual boundary and agrees with syncToNow", () => {
      const initial = start(createIdleState(CLASSIC_PRESET, T0, { totalRounds: 2 }), T0);
      const firstEnd = T0 + CLASSIC_PRESET.focusMs;
      const breakEnd = firstEnd + CLASSIC_PRESET.shortBreakMs;
      const now = breakEnd + CLASSIC_PRESET.focusMs + 1000;
      const steps = syncToNowSteps(initial, now);
      expect(steps.map((state) => [state.phase, state.phaseStartedAt])).toEqual([
        ["shortBreak", firstEnd], ["focus", breakEnd], ["completed", null],
      ]);
      expect(syncToNow(initial, now)).toEqual(steps.at(-1));
      expect(initial.phase).toBe("focus");
    });

    it("returns no steps for idle, paused, completed, or not yet due states", () => {
      const idle = createIdleState(CLASSIC_PRESET, T0, { totalRounds: 1 });
      const running = start(idle, T0);
      for (const state of [idle, running, pause(running, T0), advance(running, T0)]) {
        expect(syncToNowSteps(state, T0 + 1)).toEqual([]);
        expect(syncToNow(state, T0 + 1)).toBe(state);
      }
    });

    it("includes the automatic pause in the only step when autoContinue is off", () => {
      const initial = start(createIdleState(CLASSIC_PRESET, T0, { autoContinue: false }), T0);
      const now = T0 + 24 * 60 * 60_000;
      const steps = syncToNowSteps(initial, now);
      expect(steps).toHaveLength(1);
      expect(steps[0]).toMatchObject({ phase: "shortBreak", pausedAt: T0 + CLASSIC_PRESET.focusMs });
      expect(syncToNow(initial, now)).toEqual(steps[0]);
    });
  });

  it("setAutoContinue changes only the setting without mutating the input", () => {
    const state = start(createIdleState(CLASSIC_PRESET, T0), T0);
    const disabled = setAutoContinue(state, false);
    expect(disabled).toEqual({ ...state, autoContinue: false });
    expect(state.autoContinue).toBe(true);
    expect(setAutoContinue(disabled, true)).toEqual(state);
  });

  describe("with autoContinue disabled", () => {
    function createFocus(currentRound = 1): TimerState {
      return {
        ...start(createIdleState(CLASSIC_PRESET, T0, { autoContinue: false, totalRounds: 5 }), T0),
        currentRound,
      };
    }

    it.each([
      [1, "shortBreak", CLASSIC_PRESET.shortBreakMs],
      [4, "longBreak", CLASSIC_PRESET.longBreakMs],
    ] as const)("pauses the break after round %s at its start", (round, phase, durationMs) => {
      const end = T0 + CLASSIC_PRESET.focusMs;
      const now = end + 60_000;
      const state = syncToNow(createFocus(round), now);
      expect(state.phase).toBe(phase);
      expect(state.currentRound).toBe(round);
      expect(state.phaseStartedAt).toBe(end);
      expect(state.pausedAt).toBe(end);
      expect(state.accumulatedPauseMs).toBe(0);
      expect(isPaused(state)).toBe(true);
      expect(remainingMs(state, now)).toBe(durationMs);
    });

    it("advances only once even after an entire session's worth of time", () => {
      const now = T0 + 24 * 60 * 60_000;
      const state = syncToNow(createFocus(), now);
      expect(state.phase).toBe("shortBreak");
      expect(state.currentRound).toBe(1);
      expect(remainingMs(state, now)).toBe(CLASSIC_PRESET.shortBreakMs);
      expect(syncToNow(state, now + 60_000)).toBe(state);
    });

    it("accounts for earlier pauses when computing the natural transition time", () => {
      const paused = pause(createFocus(), T0 + 60_000);
      const running = resume(paused, T0 + 120_000);
      const end = T0 + CLASSIC_PRESET.focusMs + 60_000;
      const state = syncToNow(running, end);
      expect(state.phaseStartedAt).toBe(end);
      expect(state.pausedAt).toBe(end);
      expect(remainingMs(state, end)).toBe(CLASSIC_PRESET.shortBreakMs);
    });

    it("resumes the full break and pauses the following focus at its start", () => {
      const now = T0 + CLASSIC_PRESET.focusMs + 60_000;
      const waiting = syncToNow(createFocus(), now);
      const running = resume(waiting, now);
      expect(isRunning(running)).toBe(true);
      expect(remainingMs(running, now)).toBe(CLASSIC_PRESET.shortBreakMs);
      expect(remainingMs(running, now + 1000)).toBe(CLASSIC_PRESET.shortBreakMs - 1000);
      const end = now + CLASSIC_PRESET.shortBreakMs;
      const nextFocus = syncToNow(running, end + 60_000);
      expect(nextFocus.phase).toBe("focus");
      expect(nextFocus.currentRound).toBe(2);
      expect(nextFocus.phaseStartedAt).toBe(end);
      expect(nextFocus.pausedAt).toBe(end);
      expect(remainingMs(nextFocus, end + 60_000)).toBe(CLASSIC_PRESET.focusMs);
    });

    it("skip starts the next phase immediately, including from an automatic pause", () => {
      const now = T0 + 1000;
      const nextBreak = skip(createFocus(), now);
      expect(nextBreak.phase).toBe("shortBreak");
      expect(nextBreak.phaseStartedAt).toBe(now);
      expect(isRunning(nextBreak)).toBe(true);
      const waiting = syncToNow(createFocus(), T0 + CLASSIC_PRESET.focusMs);
      const nextFocus = skip(waiting, now + CLASSIC_PRESET.focusMs);
      expect(nextFocus.phase).toBe("focus");
      expect(nextFocus.currentRound).toBe(2);
      expect(nextFocus.phaseStartedAt).toBe(now + CLASSIC_PRESET.focusMs);
      expect(isRunning(nextFocus)).toBe(true);
    });

    it("completes the final focus without pausing", () => {
      const state = syncToNow(createFocus(5), T0 + CLASSIC_PRESET.focusMs);
      expect(state.phase).toBe("completed");
      expect(state.phaseStartedAt).toBeNull();
      expect(state.pausedAt).toBeNull();
    });
  });

  it("start() moves idle -> focus, round 1", () => {
    const s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    expect(s.phase).toBe("focus");
    expect(s.currentRound).toBe(1);
    expect(isRunning(s)).toBe(true);
  });

  it("focus -> shortBreak -> focus for non-multiple-of-4 rounds, no break after the final round", () => {
    const phases = runFullCycle(2);
    // 最終ラウンド（2ラウンド目）の focus が終わったら、休憩を挟まず即 completed になる
    expect(phases).toEqual(["focus", "shortBreak", "focus", "completed"]);
  });

  it("every 4th round takes a longBreak, but the final round skips its break entirely", () => {
    const phases = runFullCycle(4);
    expect(phases).toEqual(["focus", "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "completed"]);
  });

  it("a single-round session has no break at all", () => {
    const phases = runFullCycle(1);
    expect(phases).toEqual(["focus", "completed"]);
  });

  it("skip is equivalent to advance", () => {
    let s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    s = skip(s, T0 + 1);
    expect(s.phase).toBe("shortBreak");
  });

  it("pause/resume round-trip does not change phase or round", () => {
    let s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    s = pause(s, T0 + 1000);
    s = resume(s, T0 + 5000);
    expect(s.phase).toBe("focus");
    expect(s.currentRound).toBe(1);
  });

  it("pause is a no-op when already paused or not started", () => {
    const idle = createIdleState(CLASSIC_PRESET, T0);
    expect(pause(idle, T0)).toBe(idle);

    let s = start(idle, T0);
    s = pause(s, T0 + 1000);
    const pausedAgain = pause(s, T0 + 2000);
    expect(pausedAgain).toBe(s); // 変化なし
  });

  it("reset returns to idle from any active phase", () => {
    let s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    s = advance(s, T0 + 1); // -> shortBreak
    s = reset(s, T0 + 2);
    expect(s.phase).toBe("idle");
    expect(s.currentRound).toBe(1);
    expect(s.phaseStartedAt).toBeNull();
  });

  it("syncToNow fast-forwards through multiple elapsed phases", () => {
    let s = start(createIdleState(CLASSIC_PRESET, T0, { totalRounds: 4 }), T0);
    // 25分(focus) + 5分(break) より十分先の時刻まで一気に進める
    const farFuture = T0 + 26 * 60_000;
    s = syncToNow(s, farFuture);
    expect(s.phase).toBe("shortBreak");
  });

  it("syncToNow is a no-op if not yet overdue", () => {
    let s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    const soon = T0 + 60_000;
    const synced = syncToNow(s, soon);
    expect(synced.phase).toBe("focus");
    expect(synced.phaseStartedAt).toBe(s.phaseStartedAt);
  });
});
