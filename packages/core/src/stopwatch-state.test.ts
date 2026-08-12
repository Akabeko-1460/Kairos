import { describe, expect, it } from "vitest";
import {
  createIdleStopwatch,
  stopwatchElapsedMs,
  isStopwatchPaused,
  isStopwatchRunning,
  pauseStopwatch,
  resetStopwatch,
  resumeStopwatch,
  startStopwatch,
} from "./stopwatch-state";

const T0 = 1_000_000;

describe("stopwatch-state", () => {
  it("idle state has zero elapsed and is not running", () => {
    const s = createIdleStopwatch();
    expect(stopwatchElapsedMs(s, T0)).toBe(0);
    expect(isStopwatchRunning(s)).toBe(false);
  });

  it("counts up purely from absolute time, with no upper bound", () => {
    let s = createIdleStopwatch();
    s = startStopwatch(s, T0);
    expect(stopwatchElapsedMs(s, T0 + 90 * 60_000)).toBe(90 * 60_000); // 1時間半経ってもそのまま数え続ける
  });

  it("pause freezes elapsed time; resume shifts startedAt effectively forward", () => {
    let s = createIdleStopwatch();
    s = startStopwatch(s, T0);
    s = pauseStopwatch(s, T0 + 60_000);
    expect(isStopwatchPaused(s)).toBe(true);
    expect(isStopwatchRunning(s)).toBe(false);
    expect(stopwatchElapsedMs(s, T0 + 5 * 60_000)).toBe(60_000);

    s = resumeStopwatch(s, T0 + 10 * 60_000 + 60_000);
    expect(isStopwatchPaused(s)).toBe(false);
    expect(stopwatchElapsedMs(s, T0 + 10 * 60_000 + 60_000)).toBe(60_000);
    expect(stopwatchElapsedMs(s, T0 + 10 * 60_000 + 60_000 + 60_000)).toBe(2 * 60_000);
  });

  it("resetStopwatch returns to a fresh idle state", () => {
    let s = createIdleStopwatch();
    s = startStopwatch(s, T0);
    s = pauseStopwatch(s, T0 + 60_000);
    const reset = resetStopwatch();
    expect(reset.status).toBe("idle");
    expect(stopwatchElapsedMs(reset, T0 + 60_000)).toBe(0);
  });
});
