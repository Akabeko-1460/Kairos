import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../../core/src";
import { buildStatsView, formatFocusTime } from "../../../apps/web/lib/statsView";

const MINUTE_MS = 60_000;
const NOW = Date.UTC(2026, 9, 18, 12);
const utc = () => 0;

function record(endedAt: number, minutes: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: String(endedAt), startedAt: endedAt - minutes * MINUTE_MS, endedAt,
    phase: "focus", plannedMs: 25 * MINUTE_MS, actualMs: minutes * MINUTE_MS,
    completed: true, taskHeadline: "", soundPackId: "default", ...overrides,
  };
}

describe("stats view", () => {
  it("returns zero metrics and seven empty days without records", () => {
    const view = buildStatsView([], NOW, utc);
    expect(view.isEmpty).toBe(true);
    expect(view.today).toEqual({ focusMs: 0, completedPomodoros: 0, focusTime: "0分" });
    expect(view.streakDays).toBe(0);
    expect(view.totalPomodoros).toBe(0);
    expect(view.week).toHaveLength(7);
    expect(view.week.every((day) => day.focusMs === 0 && day.completedPomodoros === 0
      && day.heightRatio === 0 && day.focusTime === "0分")).toBe(true);
    expect(view.week.map((day) => day.label)).toEqual(["10/12", "10/13", "10/14", "10/15", "10/16", "10/17", "10/18"]);
  });

  it.each([[0, "0分"], [59, "59分"], [60, "1時間"], [85, "1時間25分"]])(
    "formats %i minutes as %s", (minutes, label) => {
      expect(formatFocusTime(Number(minutes) * MINUTE_MS)).toBe(label);
      expect(buildStatsView([record(NOW, Number(minutes))], NOW, utc).today.focusTime).toBe(label);
    },
  );

  it("normalizes the maximum day to one and includes incomplete focus time", () => {
    const view = buildStatsView([
      record(Date.UTC(2026, 9, 16, 12), 20),
      record(Date.UTC(2026, 9, 17, 12), 40),
      record(NOW, 5), record(NOW, 5, { completed: false }),
      record(NOW, 90, { phase: "shortBreak" }),
      record(Date.UTC(2026, 8, 1), 100),
    ], NOW, utc);
    expect(view.isEmpty).toBe(false);
    expect(view.week.map((day) => day.heightRatio)).toEqual([0, 0, 0, 0, 0.5, 1, 0.25]);
    expect(view.today).toEqual({ focusMs: 10 * MINUTE_MS, completedPomodoros: 1, focusTime: "10分" });
    expect(view.streakDays).toBe(3);
    expect(view.totalPomodoros).toBe(4);
  });

  it("uses local end dates across midnight and calendar year boundaries", () => {
    const now = Date.UTC(2026, 11, 31, 16);
    const view = buildStatsView([record(now, 85)], now, () => 540);
    expect(view.week[6]).toMatchObject({ date: "2027-01-01", label: "1/1", heightRatio: 1 });
    expect(view.today.focusTime).toBe("1時間25分");
  });

  it("keeps seven distinct calendar days across a DST change", () => {
    const now = Date.UTC(2026, 10, 2, 5, 30);
    const offsetAt = (ms: number) => ms < Date.UTC(2026, 10, 1, 6) ? -240 : -300;
    const view = buildStatsView([
      record(Date.UTC(2026, 10, 1, 4, 30), 25),
      record(Date.UTC(2026, 10, 1, 6, 30), 25),
    ], now, offsetAt);
    expect(view.week.map((day) => day.label)).toEqual(["10/27", "10/28", "10/29", "10/30", "10/31", "11/1", "11/2"]);
    expect(view.week[5]).toMatchObject({ focusMs: 50 * MINUTE_MS, heightRatio: 1 });
    expect(view.today.focusMs).toBe(0);
    expect(view.streakDays).toBe(1);
  });
});
