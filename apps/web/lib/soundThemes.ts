import type { IconVariant } from "@/components/SoundIcon";
import type { VisualStyleId } from "@/lib/visualStyles";
import type { ThemeId, ThemeKind } from "@kairos/audio-engine";

export interface SoundTheme {
  id: ThemeId;
  kind: ThemeKind;
  label: string;
  icon: IconVariant;
  accent: string;
  /** カテゴリごとに全く異なる生成アートを描く（lib/visualStyles.ts）。 */
  visual: VisualStyleId;
  subtitles: readonly string[];
}

// rev.3 (docs/04_SOUND_ENGINE.md ADR-004): 各テーマは packs.json 上で固有の音響定義
// （key/scale/bpm/layers/automation）を持つ。id はそのまま SoundPack.themes のキーになる。
// Home（自由再生）と Pomodoro（テーマ選択）の両方から参照する単一の定義元。
export const SOUND_THEMES: SoundTheme[] = [
  {
    id: "study",
    kind: "focus",
    label: "Study",
    icon: "book",
    accent: "#4c6ef5",
    visual: "lattice",
    subtitles: ["Steady Focus", "Quiet Concentration", "Reading Flow", "Exam Prep Mode"],
  },
  {
    id: "work",
    kind: "focus",
    label: "Work",
    icon: "focus",
    accent: "#8562f5",
    visual: "network",
    subtitles: ["Deep Work Flow", "Task Momentum", "Inbox Zero Mode", "Project Sprint"],
  },
  {
    id: "relax",
    kind: "break",
    label: "Relax",
    icon: "break",
    accent: "#3fae8e",
    visual: "flow",
    subtitles: ["Slow Exhale", "Soft Reset", "Gentle Unwind", "Afternoon Drift"],
  },
  {
    id: "sleep",
    kind: "break",
    label: "Sleep",
    icon: "crescent",
    accent: "#5b5ee6",
    visual: "starfield",
    subtitles: ["Wind Down", "Night Settle", "Drifting Off", "Quiet Hours"],
  },
  {
    id: "move",
    kind: "focus",
    label: "Move",
    icon: "motion",
    accent: "#f5a94c",
    visual: "trails",
    subtitles: ["Strength Training", "Cardio Drive", "Workout Pulse", "Power Hour"],
  },
];

/** Pomodoro の Focus フェーズ中に選べるテーマ（kind === "focus" のもののみ）。 */
export const FOCUS_SOUND_THEMES: SoundTheme[] = SOUND_THEMES.filter((t) => t.kind === "focus");
