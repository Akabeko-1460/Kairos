import { describe, expect, it } from "vitest";
import { CellScheduler } from "./cell-scheduler";
import { mulberry32 } from "./prng";
import { SCALES } from "./scales";

function collectEvents(seed: number, count: number, density: number) {
  const scheduler = new CellScheduler(mulberry32(seed), SCALES.aeolian!, 0);
  const events: { time: number; semitone: number }[] = [];
  for (let i = 0; i < count; i++) {
    const time = scheduler.advance(density);
    events.push({ time, semitone: scheduler.pick().semitone });
  }
  return events;
}

describe("CellScheduler", () => {
  it("same seed produces the same event sequence (docs/CLAUDE.md 必須テスト)", () => {
    const a = collectEvents(7, 30, 0.1);
    const b = collectEvents(7, 30, 0.1);
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const a = collectEvents(1, 30, 0.1);
    const b = collectEvents(2, 30, 0.1);
    expect(a).not.toEqual(b);
  });

  it("picked semitones are always within the given scale (mod octave)", () => {
    const scheduler = new CellScheduler(mulberry32(99), SCALES.aeolian!, 0);
    for (let i = 0; i < 200; i++) {
      const { semitone } = scheduler.pick();
      expect(SCALES.aeolian).toContain(semitone % 12);
    }
  });

  it("higher density statistically yields more events over a fixed time budget", () => {
    const TIME_BUDGET = 200; // 秒
    function countEventsWithin(density: number, seed: number): number {
      const scheduler = new CellScheduler(mulberry32(seed), SCALES.aeolian!, 0);
      let count = 0;
      while (scheduler.nextEventTime < TIME_BUDGET) {
        scheduler.advance(density);
        count++;
      }
      return count;
    }
    const low = countEventsWithin(0.02, 1);
    const high = countEventsWithin(0.2, 1);
    expect(high).toBeGreaterThan(low);
  });

  it("first event has at least a 5 second offset from phase start (唐突な発火を避ける)", () => {
    const scheduler = new CellScheduler(mulberry32(1), SCALES.aeolian!, 100);
    expect(scheduler.nextEventTime).toBe(105);
  });

  it("zero density never fires (interval is infinite)", () => {
    const scheduler = new CellScheduler(mulberry32(1), SCALES.aeolian!, 0);
    expect(scheduler.nextInterval(0)).toBe(Infinity);
  });
});
