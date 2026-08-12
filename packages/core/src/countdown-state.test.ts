import { describe, expect, it } from "vitest";
import {
  createIdleCountdown,
  countdownElapsedMs,
  isCountdownFinished,
  isCountdownPaused,
  isCountdownRunning,
  pauseCountdown,
  countdownProgress,
  countdownRemainingMs,
  resetCountdown,
  resumeCountdown,
  startCountdown,
  syncCountdownToNow,
} from "./countdown-state";

const T0 = 1_000_000;
const TEN_MIN_MS = 10 * 60_000;

describe("countdown-state", () => {
  it("idle state has zero elapsed/remaining/countdownProgress and is not running", () => {
    const s = createIdleCountdown(TEN_MIN_MS);
    expect(countdownElapsedMs(s, T0)).toBe(0);
    expect(countdownRemainingMs(s, T0)).toBe(TEN_MIN_MS);
    expect(countdownProgress(s, T0)).toBe(0);
    expect(isCountdownRunning(s)).toBe(false);
  });

  it("computes elapsed/remaining/countdownProgress purely from absolute time", () => {
    let s = createIdleCountdown(TEN_MIN_MS);
    s = startCountdown(s, T0);
    const fiveMinLater = T0 + 5 * 60_000;
    expect(countdownElapsedMs(s, fiveMinLater)).toBe(5 * 60_000);
    expect(countdownRemainingMs(s, fiveMinLater)).toBe(5 * 60_000);
    expect(countdownProgress(s, fiveMinLater)).toBeCloseTo(0.5, 10);
  });

  it("countdownProgress reaches 1.0 exactly at duration end and stays clamped after", () => {
    let s = createIdleCountdown(TEN_MIN_MS);
    s = startCountdown(s, T0);
    const end = T0 + TEN_MIN_MS;
    expect(countdownProgress(s, end)).toBe(1);
    expect(countdownProgress(s, end + 60_000)).toBe(1);
    expect(isCountdownFinished(s, end)).toBe(true);
  });

  it("syncCountdownToNow transitions to completed once the duration has elapsed", () => {
    let s = createIdleCountdown(TEN_MIN_MS);
    s = startCountdown(s, T0);
    const stillRunning = syncCountdownToNow(s, T0 + 60_000);
    expect(stillRunning.status).toBe("running");
    const finished = syncCountdownToNow(s, T0 + TEN_MIN_MS);
    expect(finished.status).toBe("completed");
  });

  it("pause freezes elapsed time; resume shifts startedAt effectively forward", () => {
    let s = createIdleCountdown(TEN_MIN_MS);
    s = startCountdown(s, T0);
    s = pauseCountdown(s, T0 + 60_000);
    expect(isCountdownPaused(s)).toBe(true);
    expect(isCountdownRunning(s)).toBe(false);
    expect(countdownElapsedMs(s, T0 + 5 * 60_000)).toBe(60_000);

    s = resumeCountdown(s, T0 + 10 * 60_000 + 60_000);
    expect(isCountdownPaused(s)).toBe(false);
    expect(countdownElapsedMs(s, T0 + 10 * 60_000 + 60_000)).toBe(60_000);
    expect(countdownElapsedMs(s, T0 + 10 * 60_000 + 60_000 + 60_000)).toBe(2 * 60_000);
  });

  it("resetCountdown returns to idle with the same duration", () => {
    let s = createIdleCountdown(TEN_MIN_MS);
    s = startCountdown(s, T0);
    s = pauseCountdown(s, T0 + 60_000);
    const reset = resetCountdown(s);
    expect(reset.status).toBe("idle");
    expect(reset.durationMs).toBe(TEN_MIN_MS);
    expect(countdownElapsedMs(reset, T0 + 60_000)).toBe(0);
  });
});
