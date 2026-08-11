import type { IconVariant } from "@/components/SoundIcon";
import type { VisualStyleId } from "@/lib/visualStyles";
import type { EnginePhase } from "@kairos/audio-engine";

export interface SoundTheme {
  id: string;
  phase: EnginePhase;
  label: string;
  icon: IconVariant;
  accent: string;
  /** カテゴリごとに全く異なる生成アートを描く（lib/visualStyles.ts）。 */
  visual: VisualStyleId;
  subtitles: readonly string[];
}

// docs/CLAUDE.md: 現状のサウンドパックは focus/break の2種類の音響エンジンしか持たないため、
// 複数カテゴリが同じ phase を共有する（見た目・配色・副題は独立させ、体験としては別物にする）。
// 将来 packs.json に専用パックが増えたら、それぞれ固有の phase / SoundPack を割り当てる。
// Home（自由再生）と Pomodoro（テーマ選択）の両方から参照する単一の定義元。
export const SOUND_THEMES: SoundTheme[] = [
  {
    id: "study",
    phase: "focus",
    label: "Study",
    icon: "book",
    accent: "#4c6ef5",
    visual: "lattice",
    subtitles: ["Steady Focus", "Quiet Concentration", "Reading Flow", "Exam Prep Mode"],
  },
  {
    id: "work",
    phase: "focus",
    label: "Work",
    icon: "focus",
    accent: "#8562f5",
    visual: "network",
    subtitles: ["Deep Work Flow", "Task Momentum", "Inbox Zero Mode", "Project Sprint"],
  },
  {
    id: "relax",
    phase: "shortBreak",
    label: "Relax",
    icon: "break",
    accent: "#3fae8e",
    visual: "flow",
    subtitles: ["Slow Exhale", "Soft Reset", "Gentle Unwind", "Afternoon Drift"],
  },
  {
    id: "sleep",
    phase: "shortBreak",
    label: "Sleep",
    icon: "crescent",
    accent: "#5b5ee6",
    visual: "starfield",
    subtitles: ["Wind Down", "Night Settle", "Drifting Off", "Quiet Hours"],
  },
  {
    id: "move",
    phase: "focus",
    label: "Move",
    icon: "motion",
    accent: "#f5a94c",
    visual: "trails",
    subtitles: ["Light Cardio", "Walking Pace", "Morning Stretch", "Energy Boost"],
  },
];

/** Pomodoro の Focus フェーズ中に選べるテーマ（phase === "focus" のもののみ）。 */
export const FOCUS_SOUND_THEMES: SoundTheme[] = SOUND_THEMES.filter((t) => t.phase === "focus");
