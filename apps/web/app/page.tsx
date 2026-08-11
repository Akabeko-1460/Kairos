"use client";

import { GeometricVisualizer } from "@/components/GeometricVisualizer";
import { SoundIcon, type IconVariant } from "@/components/SoundIcon";
import { useFreeplay } from "@/hooks/useFreeplay";
import type { EnginePhase } from "@kairos/audio-engine";
import { useMemo, useState } from "react";

const FOCUS_ACCENT = "#4c6ef5";
const BREAK_ACCENT = "#3fae8e";

const FOCUS_SUBTITLES = ["Quiet Momentum", "Deep Work Flow", "Steady Attention", "Morning Clarity"];
const BREAK_SUBTITLES = ["Slow Exhale", "Soft Reset", "Gentle Unwind", "Afternoon Drift"];

interface SoundEntry {
  id: "focus" | "break";
  phase: EnginePhase;
  label: string;
  icon: IconVariant;
  accent: string;
}

const UNLOCKED_SOUNDS: SoundEntry[] = [
  { id: "focus", phase: "focus", label: "Focus", icon: "focus", accent: FOCUS_ACCENT },
  { id: "break", phase: "shortBreak", label: "Break", icon: "break", accent: BREAK_ACCENT },
];

// 将来のサウンドパック拡張用のプレースホルダー。中身は未定なので鍵アイコンのみ表示する
// （docs/PHASE0_SPIKES.md 等で言及の通り、現状は Focus/Break の1パックのみ実装済み）。
const LOCKED_ICONS: IconVariant[] = [
  "crescent",
  "prism",
  "orbit",
  "dots",
  "leaf",
  "droplets",
  "waves",
  "flow",
  "peaks",
  "spiral",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export default function HomePage() {
  const {
    freeplayPhase,
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
  const [subtitle, setSubtitle] = useState(pick(FOCUS_SUBTITLES));

  const selected = useMemo(
    () => UNLOCKED_SOUNDS.find((s) => s.phase === freeplayPhase) ?? null,
    [freeplayPhase],
  );

  const handleSelect = async (entry: SoundEntry) => {
    if (freeplayPhase === entry.phase) {
      // 同じ音をもう一度選んだら一時停止/再開のトグルにする
      toggleFreeplayPause();
      return;
    }
    setLoadingId(entry.id);
    try {
      await ensureEngine();
      setSubtitle(pick(entry.phase === "focus" ? FOCUS_SUBTITLES : BREAK_SUBTITLES));
      await playFreeplay(entry.phase);
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
    <div className="grid-bg relative flex flex-1 flex-col items-center justify-between overflow-hidden px-8 py-14">
      <GeometricVisualizer
        active={freeplayPlaying}
        accentColor={accent}
        sides={selected?.id === "break" ? 8 : 6}
        innerRadiusRatio={0.16}
        maskOuterPercent={58}
      />

      <div className="relative flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-3xl font-medium text-foreground">{selected ? selected.label : "Kairos"}</h1>
        <p className="text-sm text-muted">
          {selected ? subtitle : "集中と休憩に合わせて生成されるサウンドスケープを選んでください"}
        </p>
      </div>

      <div className="relative z-10 mb-10 flex max-w-2xl flex-wrap items-center justify-center gap-4">
        {UNLOCKED_SOUNDS.map((entry) => {
          const active = freeplayPhase === entry.phase;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => handleSelect(entry)}
              disabled={loadingId === entry.id}
              aria-label={entry.label}
              className="flex h-14 w-14 items-center justify-center rounded-full border transition-colors disabled:opacity-50"
              style={{
                borderColor: active ? entry.accent : "var(--border)",
                color: active ? entry.accent : "var(--muted)",
                backgroundColor: active ? `${entry.accent}1a` : "transparent",
              }}
            >
              <SoundIcon variant={entry.icon} size={24} />
            </button>
          );
        })}

        {LOCKED_ICONS.map((icon) => (
          <span
            key={icon}
            className="flex h-14 w-14 items-center justify-center rounded-full border border-border text-muted/50"
            title="Coming soon"
          >
            <SoundIcon variant={icon} locked size={22} />
          </span>
        ))}
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

        <div className="ml-2 flex flex-1 items-center gap-2">
          <span className="text-muted">🔊</span>
          <input
            type="range"
            name="masterVolume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="w-full accent-current"
            style={{ color: accent }}
          />
        </div>
      </div>
    </div>
  );
}
