"use client";

import { FocusThemeSelector } from "@/components/FocusThemeSelector";
import { TimerRing } from "@/components/TimerRing";
import { VolumeSlider } from "@/components/VolumeSlider";
import { useCountdownStore } from "@/hooks/useCountdown";
import { useFreeplay } from "@/hooks/useFreeplay";
import { useNow } from "@/hooks/useNow";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { formatMmSs } from "@/lib/formatTime";
import { SOUND_THEMES } from "@/lib/soundThemes";
import {
  countdownProgress,
  countdownRemainingMs,
  isCountdownFinished,
  isCountdownRunning,
} from "@kairos/core";
import type { ThemeId } from "@kairos/audio-engine";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const buttonMotion = { whileHover: { scale: 1.04 }, whileTap: { scale: 0.95 } } as const;
const DURATION_PRESETS_MIN = [5, 10, 15, 20, 30, 45, 60];

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "TIMER";
    case "paused":
      return "PAUSED";
    case "completed":
      return "TIME'S UP";
    default:
      return "READY";
  }
}

export default function TimerPage() {
  const state = useCountdownStore((s) => s.state);
  const start = useCountdownStore((s) => s.start);
  const pause = useCountdownStore((s) => s.pause);
  const resume = useCountdownStore((s) => s.resume);
  const reset = useCountdownStore((s) => s.reset);
  const setDurationMs = useCountdownStore((s) => s.setDurationMs);
  const syncToNow = useCountdownStore((s) => s.syncToNow);

  const { engineReady, ensureEngine, playFreeplay, stopFreeplay, toggleFreeplayPause, masterVolume, setMasterVolume } =
    useFreeplay();
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);

  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(SOUND_THEMES[0]!.id);
  const [starting, setStarting] = useState(false);

  const running = isCountdownRunning(state);
  const now = useNow(running);
  const isIdle = state.status === "idle" || state.status === "completed";

  const theme = SOUND_THEMES.find((t) => t.id === selectedThemeId) ?? SOUND_THEMES[0]!;
  const accent = theme.accent;

  // 残り時間が尽きたら、鳴っている音をフェードアウトさせて completed へ確定させる。
  // 「setInterval の回数は数えない」の原則通り、判定自体は毎フレーム @kairos/core の
  // 純粋関数（isCountdownFinished）で絶対時刻から再計算する。
  useEffect(() => {
    if (!running) return;
    if (isCountdownFinished(state, now)) {
      syncToNow();
      stopFreeplay();
    }
  }, [running, state, now, syncToNow, stopFreeplay]);

  useEffect(() => {
    setBackgroundArt({
      active: running,
      styleId: theme.visual,
      accentColor: theme.accent,
      holeRadiusRatio: 0,
      seed: SOUND_THEMES.indexOf(theme) + 1,
    });
  }, [theme, running, setBackgroundArt]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await ensureEngine();
      await playFreeplay(selectedThemeId);
      start();
    } finally {
      setStarting(false);
    }
  };

  const handleResumeAudio = async () => {
    setStarting(true);
    try {
      await ensureEngine();
      await playFreeplay(selectedThemeId);
    } finally {
      setStarting(false);
    }
  };

  const handlePause = () => {
    pause();
    toggleFreeplayPause();
  };

  const handleResume = () => {
    resume();
    toggleFreeplayPause();
  };

  const handleReset = () => {
    reset();
    stopFreeplay();
  };

  return (
    <div className="relative flex flex-1 items-center justify-center px-8 py-12">
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:items-start lg:justify-center lg:gap-20">
        <div className="flex flex-col items-center gap-8">
          <TimerRing
            progress={countdownProgress(state, now)}
            label={statusLabel(state.status)}
            timeLabel={formatMmSs(countdownRemainingMs(state, now))}
            accentColor={accent}
          />

          <div className="flex items-center gap-4">
            {isIdle ? (
              <motion.button
                {...buttonMotion}
                type="button"
                onClick={handleStart}
                disabled={starting}
                className="rounded-full px-8 py-3 text-sm font-medium text-background disabled:opacity-50"
                style={{ backgroundColor: accent }}
              >
                {starting ? "準備中…" : "Start"}
              </motion.button>
            ) : !engineReady ? (
              <>
                <motion.button
                  {...buttonMotion}
                  type="button"
                  onClick={handleResumeAudio}
                  disabled={starting}
                  className="rounded-full px-8 py-3 text-sm font-medium text-background disabled:opacity-50"
                  style={{ backgroundColor: accent }}
                >
                  {starting ? "再開中…" : "Resume Audio"}
                </motion.button>
                <motion.button
                  {...buttonMotion}
                  type="button"
                  onClick={handleReset}
                  className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                >
                  Reset
                </motion.button>
              </>
            ) : (
              <>
                {state.status === "paused" ? (
                  <motion.button
                    {...buttonMotion}
                    type="button"
                    onClick={handleResume}
                    className="rounded-full px-6 py-2.5 text-sm font-medium text-background"
                    style={{ backgroundColor: accent }}
                  >
                    Resume
                  </motion.button>
                ) : (
                  <motion.button
                    {...buttonMotion}
                    type="button"
                    onClick={handlePause}
                    className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                  >
                    Pause
                  </motion.button>
                )}
                <motion.button
                  {...buttonMotion}
                  type="button"
                  onClick={handleReset}
                  className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                >
                  Reset
                </motion.button>
              </>
            )}
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-8 lg:items-start">
          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">DURATION</p>
              <div className="flex flex-wrap items-center gap-2">
                {DURATION_PRESETS_MIN.map((min) => {
                  const active = state.durationMs === min * 60_000;
                  return (
                    <button
                      key={min}
                      type="button"
                      onClick={() => setDurationMs(min * 60_000)}
                      className="rounded-full border px-4 py-1.5 text-xs"
                      style={{
                        borderColor: active ? accent : "var(--border)",
                        color: active ? accent : "var(--muted)",
                      }}
                    >
                      {min}分
                    </button>
                  );
                })}
                <label className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={Math.round(state.durationMs / 60_000)}
                    onChange={(e) => {
                      const min = Number(e.target.value);
                      if (Number.isFinite(min) && min > 0) setDurationMs(min * 60_000);
                    }}
                    className="w-10 bg-transparent text-center text-foreground focus:outline-none"
                    aria-label="カスタムの分数"
                  />
                  分
                </label>
              </div>
            </div>
          )}

          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">SOUND</p>
              <FocusThemeSelector selectedId={selectedThemeId} onSelect={setSelectedThemeId} themes={SOUND_THEMES} />
            </div>
          )}

          <div className="w-[252px]">
            <VolumeSlider value={masterVolume} onChange={setMasterVolume} accentColor={accent} />
          </div>
        </div>
      </div>
    </div>
  );
}
