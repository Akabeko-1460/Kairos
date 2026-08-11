import { describe, expect, it } from "vitest";
import { focusAutomation, valueAt } from "./automation";
import type { Keyframes } from "./types";

describe("valueAt", () => {
  const kf: Keyframes = [
    [0, 0],
    [0.5, 10],
    [1, 0],
  ];

  it("returns the first value at and before t=0", () => {
    expect(valueAt(kf, 0)).toBe(0);
    expect(valueAt(kf, -1)).toBe(0);
  });

  it("returns the last value at and after t=1", () => {
    expect(valueAt(kf, 1)).toBe(0);
    expect(valueAt(kf, 2)).toBe(0);
  });

  it("interpolates linearly between keyframes", () => {
    expect(valueAt(kf, 0.25)).toBeCloseTo(5, 10);
    expect(valueAt(kf, 0.5)).toBeCloseTo(10, 10);
    expect(valueAt(kf, 0.75)).toBeCloseTo(5, 10);
  });

  it("handles an empty keyframe list without throwing", () => {
    expect(valueAt([], 0.5)).toBe(0);
  });

  it("focusAutomation pulse is exactly flat (±0) through the sustain window", () => {
    // docs/04_SOUND_ENGINE.md §4.1: Sustain 区間 (0.10–0.85) は完全に一定
    expect(valueAt(focusAutomation.pulse, 0.1)).toBeCloseTo(0.55, 10);
    expect(valueAt(focusAutomation.pulse, 0.5)).toBeCloseTo(0.55, 10);
    expect(valueAt(focusAutomation.pulse, 0.85)).toBeCloseTo(0.55, 10);
  });
});
