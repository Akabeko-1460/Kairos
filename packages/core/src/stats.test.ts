import { describe, expect, it } from "vitest";
import {
  currentStreakDays,
  summarizeDay,
  summarizeLastDays,
  totalCompletedPomodoros,
  type OffsetMinutesAt,
  type SessionRecord,
} from "./index";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const utc: OffsetMinutesAt = () => 0;
const jst: OffsetMinutesAt = () => 540;

function record(endedAt: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: String(endedAt),
    startedAt: endedAt - 25 * MINUTE_MS,
    endedAt,
    phase: "focus",
    plannedMs: 25 * MINUTE_MS,
    actualMs: 25 * MINUTE_MS,
    completed: true,
    taskHeadline: "Task",
    soundPackId: "default",
    ...overrides,
  };
}

describe("summarizeDay", () => {
  it("includes unfinished focus time but counts only completed focus sessions", () => {
    const records = [
      record(DAY_MS, { actualMs: 100 }),
      record(DAY_MS + 1, { actualMs: 40, completed: false }),
      ...(["shortBreak", "longBreak", "idle", "completed"] as const).map((phase) => (
        record(DAY_MS + 2, { phase })
      )),
      record(DAY_MS - 1),
      record(2 * DAY_MS),
    ];
    expect(summarizeDay(records, DAY_MS, utc)).toEqual({ focusMs: 140, completedPomodoros: 1 });
  });

  it("uses the JST midnight boundary and assigns crossing sessions to their end day", () => {
    const midnight = 15 * 60 * MINUTE_MS;
    const records = [
      record(midnight - 1, { actualMs: 10 }),
      record(midnight, { actualMs: 20 }),
      record(midnight + 1, { actualMs: 30 }),
    ];
    expect(summarizeDay(records, -9 * 60 * MINUTE_MS, jst))
      .toEqual({ focusMs: 10, completedPomodoros: 1 });
    expect(summarizeDay(records, midnight, jst))
      .toEqual({ focusMs: 50, completedPomodoros: 2 });
  });

  it("returns zero for an empty day", () => {
    expect(summarizeDay([], 0, utc)).toEqual({ focusMs: 0, completedPomodoros: 0 });
  });
});

describe("summarizeLastDays", () => {
  it("returns seven days oldest first, filling gaps and excluding dates outside the range", () => {
    const records = [record(8 * DAY_MS), record(DAY_MS), record(2 * DAY_MS), record(9 * DAY_MS)];
    expect(summarizeLastDays(records, 8 * DAY_MS, 7, utc)).toEqual([
      { focusMs: 25 * MINUTE_MS, completedPomodoros: 1 },
      ...Array.from({ length: 5 }, () => ({ focusMs: 0, completedPomodoros: 0 })),
      { focusMs: 25 * MINUTE_MS, completedPomodoros: 1 },
    ]);
  });

  it.each([0, 60])("uses calendar days when the offset changes from %i minutes", (initialOffset) => {
    const finalOffset = 60 - initialOffset;
    const offset: OffsetMinutesAt = (ms) => ms < 2 * DAY_MS ? initialOffset : finalOffset;
    const records = [record(DAY_MS + 12 * 60 * MINUTE_MS), record(2 * DAY_MS + 12 * 60 * MINUTE_MS)];
    // Just after local midnight on day 3; subtracting 24h can repeat or skip a local day.
    const now = 3 * DAY_MS - finalOffset * MINUTE_MS + 30 * MINUTE_MS;
    expect(summarizeLastDays(records, now, 3, offset)).toEqual([
      { focusMs: 25 * MINUTE_MS, completedPomodoros: 1 },
      { focusMs: 25 * MINUTE_MS, completedPomodoros: 1 },
      { focusMs: 0, completedPomodoros: 0 },
    ]);
    expect(currentStreakDays(records, now, offset)).toBe(2);
  });

  it("handles zero days and rejects invalid day counts", () => {
    expect(summarizeLastDays([], 0, 0, utc)).toEqual([]);
    for (const days of [-1, 1.5, NaN, Infinity]) {
      expect(() => summarizeLastDays([], 0, days, utc)).toThrow(RangeError);
    }
  });
});

describe("currentStreakDays", () => {
  it("starts yesterday when today has no completions and stops at a gap", () => {
    const records = [
      record(5 * DAY_MS, { completed: false }),
      record(4 * DAY_MS),
      record(4 * DAY_MS + 1),
      record(3 * DAY_MS),
      record(2 * DAY_MS, { phase: "shortBreak" }),
      record(DAY_MS),
    ];
    expect(currentStreakDays(records, 5 * DAY_MS, utc)).toBe(2);
  });

  it("includes today and ignores future records", () => {
    const records = [record(4 * DAY_MS), record(3 * DAY_MS), record(5 * DAY_MS)];
    expect(currentStreakDays(records, 4 * DAY_MS, utc)).toBe(2);
  });

  it("uses JST dates for the current day and session endings", () => {
    const midnight = 15 * 60 * MINUTE_MS;
    expect(currentStreakDays([record(midnight), record(midnight - 1)], midnight, jst)).toBe(2);
  });

  it("returns zero when today and yesterday have no completions", () => {
    expect(currentStreakDays([], 3 * DAY_MS, utc)).toBe(0);
    expect(currentStreakDays([record(DAY_MS)], 3 * DAY_MS, utc)).toBe(0);
  });
});

describe("totalCompletedPomodoros", () => {
  it("counts completed focus records across all dates without changing input", () => {
    const records = Object.freeze([
      Object.freeze(record(0)),
      Object.freeze(record(DAY_MS)),
      Object.freeze(record(2 * DAY_MS, { completed: false })),
      Object.freeze(record(3 * DAY_MS, { phase: "longBreak" })),
    ]);
    expect(totalCompletedPomodoros(records)).toBe(2);
    expect(totalCompletedPomodoros([])).toBe(0);
    expect(summarizeLastDays(records, DAY_MS, 2, utc)).toHaveLength(2);
    expect(summarizeDay(records, 0, utc).completedPomodoros).toBe(1);
    expect(currentStreakDays(records, DAY_MS, utc)).toBe(2);
  });
});
