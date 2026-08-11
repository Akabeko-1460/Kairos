import { describe, expect, it } from "vitest";
import { CLASSIC_PRESET } from "./preset";
import {
  createIdleState,
  elapsedMs,
  isPaused,
  isPhaseComplete,
  isRunning,
  phaseDurationMs,
  progress,
  remainingMs,
} from "./timer-state";
import { pause, resume, start } from "./transitions";

const T0 = 1_000_000;

describe("timer-state", () => {
  it("idle state has zero elapsed/remaining/progress", () => {
    const s = createIdleState(CLASSIC_PRESET, T0);
    expect(elapsedMs(s, T0)).toBe(0);
    expect(remainingMs(s, T0)).toBe(0);
    expect(progress(s, T0)).toBe(0);
    expect(isRunning(s)).toBe(false);
  });

  it("computes elapsed/remaining/progress purely from absolute time, not tick count", () => {
    let s = createIdleState(CLASSIC_PRESET, T0);
    s = start(s, T0);

    const fiveMinLater = T0 + 5 * 60_000;
    expect(elapsedMs(s, fiveMinLater)).toBe(5 * 60_000);
    expect(remainingMs(s, fiveMinLater)).toBe(20 * 60_000);
    expect(progress(s, fiveMinLater)).toBeCloseTo(5 / 25, 10);
  });

  it("progress reaches 1.0 exactly at phase end and stays clamped after", () => {
    let s = createIdleState(CLASSIC_PRESET, T0);
    s = start(s, T0);
    const end = T0 + phaseDurationMs(s);
    expect(progress(s, end)).toBe(1);
    expect(progress(s, end + 60_000)).toBe(1);
    expect(isPhaseComplete(s, end)).toBe(true);
  });

  it("pause freezes elapsed time; resume shifts phaseStartedAt effectively forward", () => {
    let s = createIdleState(CLASSIC_PRESET, T0);
    s = start(s, T0);
    s = pause(s, T0 + 60_000); // 1分経過後に一時停止
    expect(isPaused(s)).toBe(true);
    expect(isRunning(s)).toBe(false);

    // 一時停止中は elapsed が動かない
    expect(elapsedMs(s, T0 + 5 * 60_000)).toBe(60_000);

    // 10分間一時停止したまま resume
    s = resume(s, T0 + 10 * 60_000 + 60_000);
    expect(isPaused(s)).toBe(false);
    // resume 直後の elapsed は pause 直前と同じ
    expect(elapsedMs(s, T0 + 10 * 60_000 + 60_000)).toBe(60_000);
    // resume から1分経てば elapsed は 2分
    expect(elapsedMs(s, T0 + 10 * 60_000 + 60_000 + 60_000)).toBe(2 * 60_000);
  });
});
