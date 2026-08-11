"use client";

import { GeometricVisualizer } from "@/components/GeometricVisualizer";
import { SoundIcon, type IconVariant } from "@/components/SoundIcon";
import { useFreeplay } from "@/hooks/useFreeplay";
import type { VisualStyleId } from "@/lib/visualStyles";
import type { EnginePhase } from "@kairos/audio-engine";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";

interface SoundEntry {
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
const SOUNDS: SoundEntry[] = [
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

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export default function HomePage() {
  const {
    freeplayCategoryId,
    freeplayPlaying,
    ensureEngine,
    playFreeplay,
    toggleFreeplayPause,
    regenerateFreeplay,
    stopFreeplay,
    setMasterVolume,
  } = useFreeplay();

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [subtitle, setSubtitle] = useState("");

  const selected = useMemo(() => SOUNDS.find((s) => s.id === freeplayCategoryId) ?? null, [freeplayCategoryId]);

  const handleSelect = async (entry: SoundEntry) => {
    if (freeplayCategoryId === entry.id) {
      // 同じ音をもう一度選んだら一時停止/再開のトグルにする
      toggleFreeplayPause();
      return;
    }
    setLoadingId(entry.id);
    try {
      await ensureEngine();
      setSubtitle(pick(entry.subtitles));
      await playFreeplay(entry.id, entry.phase);
      setMasterVolume(volume);
    } finally {
      setLoadingId(null);
    }
  };

  const handleVolumeChange = (v: number) => {
    setVolume(v);
    setMasterVolume(v);
  };

  const accent = selected?.accent ?? "#8b8b93";

  return (
    <div className="relative flex flex-1 flex-col items-center justify-between overflow-hidden px-8 py-14">
      <GeometricVisualizer
        active={freeplayPlaying}
        accentColor={accent}
        styleId={selected?.visual ?? "starfield"}
        seed={selected ? SOUNDS.indexOf(selected) + 1 : 0}
      />

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={selected ? selected.id : "idle"}
            initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="text-3xl font-medium text-foreground">{selected ? selected.label : "Kairos"}</h1>
            <p className="mt-3 text-sm text-muted">
              {selected ? subtitle : "集中と休憩に合わせて生成されるサウンドスケープを選んでください"}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="relative z-10 mb-10 flex max-w-2xl flex-wrap items-center justify-center gap-5">
        {SOUNDS.map((entry) => {
          const active = freeplayCategoryId === entry.id;
          return (
            <div key={entry.id} className="flex flex-col items-center gap-2">
              <motion.button
                type="button"
                onClick={() => handleSelect(entry)}
                disabled={loadingId === entry.id}
                aria-label={entry.label}
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.94 }}
                className="relative flex h-16 w-16 items-center justify-center rounded-full border disabled:opacity-50"
                style={{
                  borderColor: active ? entry.accent : "var(--border)",
                  color: active ? entry.accent : "var(--muted)",
                }}
              >
                {active && (
                  <motion.span
                    layoutId="home-sound-active-ring"
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: `${entry.accent}1a`, boxShadow: `0 0 24px 0 ${entry.accent}40` }}
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">
                  <SoundIcon variant={entry.icon} size={24} />
                </span>
              </motion.button>
              <span className="text-[10px] tracking-wide text-muted">{entry.label}</span>
            </div>
          );
        })}
      </div>

      <div className="relative z-10 flex w-full max-w-md items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => selected && toggleFreeplayPause()}
          disabled={!selected}
          aria-label={freeplayPlaying ? "一時停止" : "再生"}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-30"
        >
          {freeplayPlaying ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          onClick={() => selected && regenerateFreeplay()}
          disabled={!selected}
          aria-label="別のバリエーションを生成"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-30"
        >
          ⟳
        </button>
        <button
          type="button"
          onClick={() => selected && stopFreeplay()}
          disabled={!selected}
          aria-label="停止"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-30"
        >
          ■
        </button>

        <div className="ml-2 flex items-center gap-2">
          <span className="text-xs text-muted/70">🔉</span>
          <input
            type="range"
            name="masterVolume"
            aria-label="音量"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="subtle-slider w-24"
            style={{ color: accent }}
          />
        </div>
      </div>
    </div>
  );
}
