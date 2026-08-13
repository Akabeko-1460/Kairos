import { describe, expect, it } from "vitest";
import { valueAt } from "./automation";
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
});
