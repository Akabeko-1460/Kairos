import { describe, expect, it } from "vitest";
import { createCustomPreset } from "./preset";

describe("createCustomPreset", () => {
  it("converts minutes to ms and derives a 3x long break", () => {
    const preset = createCustomPreset({ focusMinutes: 45, breakMinutes: 8, roundsBeforeLongBreak: 3 });
    expect(preset.focusMs).toBe(45 * 60_000);
    expect(preset.shortBreakMs).toBe(8 * 60_000);
    expect(preset.longBreakMs).toBe(8 * 60_000 * 3);
    expect(preset.roundsBeforeLongBreak).toBe(3);
    expect(preset.label).toBe("45 / 8");
    expect(preset.isCustom).toBe(true);
  });

  it("generates a unique id per call so multiple custom presets can coexist", () => {
    const a = createCustomPreset({ focusMinutes: 20, breakMinutes: 5, roundsBeforeLongBreak: 4 });
    const b = createCustomPreset({ focusMinutes: 20, breakMinutes: 5, roundsBeforeLongBreak: 4 });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("custom:")).toBe(true);
  });

  it("clamps roundsBeforeLongBreak to at least 1", () => {
    const preset = createCustomPreset({ focusMinutes: 10, breakMinutes: 2, roundsBeforeLongBreak: 0 });
    expect(preset.roundsBeforeLongBreak).toBe(1);
  });
});
