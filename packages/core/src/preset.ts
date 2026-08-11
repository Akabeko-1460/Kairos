/**
 * プリセット定義。docs/02_SPEC.md §5 のデータモデルに準拠。
 */
export type PresetId = "classic" | "deep" | "custom";

export interface PomodoroPreset {
  readonly id: PresetId;
  readonly label: string; // '25 / 5'
  readonly focusMs: number;
  readonly shortBreakMs: number;
  readonly longBreakMs: number;
  readonly roundsBeforeLongBreak: number;
}

const MINUTE_MS = 60_000;

export const CLASSIC_PRESET: PomodoroPreset = {
  id: "classic",
  label: "25 / 5",
  focusMs: 25 * MINUTE_MS,
  shortBreakMs: 5 * MINUTE_MS,
  longBreakMs: 15 * MINUTE_MS,
  roundsBeforeLongBreak: 4,
};

export const DEEP_PRESET: PomodoroPreset = {
  id: "deep",
  label: "50 / 10",
  focusMs: 50 * MINUTE_MS,
  shortBreakMs: 10 * MINUTE_MS,
  longBreakMs: 20 * MINUTE_MS,
  roundsBeforeLongBreak: 4,
};

export const PRESETS: Readonly<Record<"classic" | "deep", PomodoroPreset>> = {
  classic: CLASSIC_PRESET,
  deep: DEEP_PRESET,
};

/** F-20（インターバル長のカスタム設定、Phase 3）向け。 */
export function customPreset(overrides: {
  focusMs: number;
  shortBreakMs: number;
  longBreakMs: number;
  roundsBeforeLongBreak: number;
}): PomodoroPreset {
  return {
    id: "custom",
    label: "Custom",
    ...overrides,
  };
}
