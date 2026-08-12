"use client";

import { SoundIcon } from "@/components/SoundIcon";
import { VolumeSlider } from "@/components/VolumeSlider";
import { useFreeplay } from "@/hooks/useFreeplay";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { SOUND_THEMES, type SoundTheme } from "@/lib/soundThemes";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

// Home と Pomodoro の両方から参照する単一の定義元（lib/soundThemes.ts）。
const SOUNDS = SOUND_THEMES;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export default function HomePage() {
  const {
    freeplayThemeId,
    freeplayPlaying,
    mode,
    ensureEngine,
    playFreeplay,
    toggleFreeplayPause,
    masterVolume,
    setMasterVolume,
  } = useFreeplay();
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);

  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");

  // mode が "freeplay" でない間（Pomodoro/Timer/Stopwatch を経由した直後など）は
  // freeplayThemeId が古い選択を持ち越していても無視し、必ず「Kairos」の初期表示に戻す。
  const isFreeplayActive = mode === "freeplay";
  const selected = useMemo(
    () => (isFreeplayActive ? (SOUNDS.find((s) => s.id === freeplayThemeId) ?? null) : null),
    [isFreeplayActive, freeplayThemeId],
  );
  const playing = isFreeplayActive && freeplayPlaying;

  // 画面全体（ヘッダーも含む）で共有する背景アートに、このページの状態を反映する。
  useEffect(() => {
    setBackgroundArt({
      active: playing,
      styleId: selected?.visual ?? "starfield",
      accentColor: selected?.accent ?? "#8b8b93",
      holeRadiusRatio: 0,
      seed: selected ? SOUNDS.indexOf(selected) + 1 : 0,
    });
  }, [selected, playing, setBackgroundArt]);

  const handleSelect = async (entry: SoundTheme) => {
    if (freeplayThemeId === entry.id) {
      // 同じ音をもう一度選んだら一時停止/再開のトグルにする
      toggleFreeplayPause();
      return;
    }
    setLoadingId(entry.id);
    try {
      await ensureEngine();
      setSubtitle(pick(entry.subtitles));
      await playFreeplay(entry.id);
    } finally {
      setLoadingId(null);
    }
  };

  const accent = selected?.accent ?? "#8b8b93";

  return (
    <div className="flex flex-1 flex-col items-center justify-between px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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
              {selected ? subtitle : "動作に合わせて、生成されるサウンドを選んでください"}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mb-10 flex max-w-2xl flex-wrap items-center justify-center gap-5">
        {SOUNDS.map((entry) => {
          const active = freeplayThemeId === entry.id;
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
                {/*
                  この span がインライン(非flex)のままだと、中の SVG がテキストのベースラインに
                  乗ってしまい、行の下に見えないディセンダー分の余白ができてアイコンが心持ち
                  上にズレて見える。flex にしてベースライン計算を経由させないことで解消する。
                */}
                <span className="relative flex">
                  <SoundIcon variant={entry.icon} size={24} />
                </span>
              </motion.button>
              <span className="text-[10px] tracking-wide text-muted">{entry.label}</span>
            </div>
          );
        })}
      </div>

      <div className="flex w-full max-w-xs items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => selected && toggleFreeplayPause()}
          disabled={!selected}
          aria-label={playing ? "一時停止" : "再生"}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border text-foreground disabled:opacity-30"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <VolumeSlider value={masterVolume} onChange={setMasterVolume} accentColor={accent} className="ml-2 flex-1" />
      </div>
    </div>
  );
}
