import { describe, expect, it } from "vitest";
import { isPulseLoopAligned, loopSecondsForBeats } from "./pulse-loop";

describe("isPulseLoopAligned", () => {
  it("accepts a loop length that is an exact integer number of beats", () => {
    expect(isPulseLoopAligned(loopSecondsForBeats(8, 68), 68)).toBe(true);
    expect(isPulseLoopAligned(loopSecondsForBeats(8, 76), 76)).toBe(true);
    expect(isPulseLoopAligned(loopSecondsForBeats(16, 112), 112)).toBe(true);
  });

  it("rejects a loop length that leaves a partial beat (the loop would drift out of time)", () => {
    expect(isPulseLoopAligned(7.0, 68)).toBe(false); // 8拍 = 7.0588...秒であって7.0秒ではない
  });

  it("rejects non-positive bpm or loopSeconds", () => {
    expect(isPulseLoopAligned(1, 0)).toBe(false);
    expect(isPulseLoopAligned(0, 60)).toBe(false);
  });
});
