/**
 * プリセット定義。docs/02_SPEC.md §5 のデータモデルに準拠。
 *
 * `id` はビルトイン（"classic" / "deep"）は固定文字列、ユーザー作成のカスタムプリセット
 * （F-20）は `custom:` で始まる一意な文字列にする。複数のカスタムプリセットを共存させ、
 * 個別に削除できるようにするため、"custom" という単一の共有IDにはしない。
 */
export type BuiltinPresetId = "classic" | "deep";

export interface PomodoroPreset {
  readonly id: string;
  readonly label: string; // '25 / 5'
  readonly focusMs: number;
  readonly shortBreakMs: number;
  readonly longBreakMs: number;
  readonly roundsBeforeLongBreak: number;
  /** ユーザーが作成し、削除可能なプリセットかどうか。ビルトイン(classic/deep)は false。 */
  readonly isCustom?: boolean;
}

const MINUTE_MS = 60_000;

/** アプリ起動時の既定プリセット。25分Focus / 5分Break。 */
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

export const PRESETS: Readonly<Record<BuiltinPresetId, PomodoroPreset>> = {
  classic: CLASSIC_PRESET,
  deep: DEEP_PRESET,
};

function generateCustomPresetId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom:${Date.now().toString(36)}:${random}`;
}

/**
 * F-20（インターバル長のカスタム設定）。UI 側は Focus分・Break分・長い休憩までのラウンド数のみ
 * 入力させる想定（`02_SPEC.md` の3フィールド）。長い休憩の長さは Break の3倍を既定値にする。
 */
export function createCustomPreset(input: {
  focusMinutes: number;
  breakMinutes: number;
  roundsBeforeLongBreak: number;
}): PomodoroPreset {
  const focusMs = Math.round(input.focusMinutes * MINUTE_MS);
  const shortBreakMs = Math.round(input.breakMinutes * MINUTE_MS);
  const longBreakMs = shortBreakMs * 3;
  const roundsBeforeLongBreak = Math.max(1, Math.round(input.roundsBeforeLongBreak));
  return {
    id: generateCustomPresetId(),
    label: `${input.focusMinutes} / ${input.breakMinutes}`,
    focusMs,
    shortBreakMs,
    longBreakMs,
    roundsBeforeLongBreak,
    isCustom: true,
  };
}
