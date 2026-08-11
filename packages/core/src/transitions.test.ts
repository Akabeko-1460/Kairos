import { describe, expect, it } from "vitest";
import { CLASSIC_PRESET } from "./preset";
import { createIdleState, isRunning, type TimerState } from "./timer-state";
import { advance, pause, reset, resume, skip, start, syncToNow } from "./transitions";

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
  it("start() moves idle -> focus, round 1", () => {
    const s = start(createIdleState(CLASSIC_PRESET, T0), T0);
    expect(s.phase).toBe("focus");
    expect(s.currentRound).toBe(1);
    expect(isRunning(s)).toBe(true);
  });

  it("focus -> shortBreak -> focus for non-multiple-of-4 rounds", () => {
    const phases = runFullCycle(2);
    // 各 focus の後に shortBreak が入り、totalRounds 到達後の break の直後に completed になる
    expect(phases).toEqual(["focus", "shortBreak", "focus", "shortBreak", "completed"]);
  });

  it("every 4th round takes a longBreak, then completes at totalRounds", () => {
    const phases = runFullCycle(4);
    expect(phases).toEqual(["focus", "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "longBreak", "completed"]);
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
