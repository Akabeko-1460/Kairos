"use client";

import { FocusThemeSelector } from "@/components/FocusThemeSelector";
import { TimerRing } from "@/components/TimerRing";
import { VolumeSlider } from "@/components/VolumeSlider";
import { useFreeplay } from "@/hooks/useFreeplay";
import { useNow } from "@/hooks/useNow";
import { useStopwatchStore } from "@/hooks/useStopwatch";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { formatStopwatch } from "@/lib/formatTime";
import { SOUND_THEMES } from "@/lib/soundThemes";
import { isStopwatchRunning, stopwatchElapsedMs } from "@kairos/core";
import type { ThemeId } from "@kairos/audio-engine";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const buttonMotion = { whileHover: { scale: 1.04 }, whileTap: { scale: 0.95 } } as const;
/** リングは固定時間を持たないので、1分周期でループさせる（秒針が1周する感覚）。 */
const RING_LOOP_MS = 60_000;

function statusLabel(status: string): string {
  switch (status) {
    case "running":
      return "STOPWATCH";
    case "paused":
      return "PAUSED";
    default:
      return "READY";
  }
}

export default function StopwatchPage() {
  const state = useStopwatchStore((s) => s.state);
  const start = useStopwatchStore((s) => s.start);
  const pause = useStopwatchStore((s) => s.pause);
  const resume = useStopwatchStore((s) => s.resume);
  const reset = useStopwatchStore((s) => s.reset);

  const {
    engineReady,
    debugInfo,
    freeplayThemeId,
    freeplayPlaying,
    ensureEngine,
    playFreeplay,
    toggleFreeplayPause,
    masterVolume,
    setMasterVolume,
  } = useFreeplay();
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);

  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(SOUND_THEMES[0]!.id);
  const [starting, setStarting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const running = isStopwatchRunning(state);
  const now = useNow(running);
  const isIdle = state.status === "idle";
  const isPreviewingSelected = freeplayPlaying && freeplayThemeId === selectedThemeId;
  // ブラウザの自動再生ポリシーで AudioContext が suspended のまま留め置かれている状態。
  // この画面上の次のクリック/タップで自動的に再開する保険（SoundscapeEngine.armGestureUnlock）
  // が張ってあるので、ここではその間の理由を利用者に示すだけに留める。
  const audioSuspended = engineReady && debugInfo?.contextState === "suspended";

  const theme = SOUND_THEMES.find((t) => t.id === selectedThemeId) ?? SOUND_THEMES[0]!;
  const accent = theme.accent;
  const elapsed = stopwatchElapsedMs(state, now);

  // 設定画面（idle）に入った瞬間から、選択中のサウンドと背景を再生しておく（Timer と同じ仕様）。
  // engineReady を待たず、ここで直接 ensureEngine() を呼ぶ（既に用意済みなら即resolveする
  // だけなので安全）。TopNav の Timers メニューはクリック時点で先取り初期化もしているが、
  // それに頼り切らずこの画面自身でも起動できるようにしている。
  useEffect(() => {
    if (!isIdle || isPreviewingSelected) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureEngine();
        if (cancelled) return;
        await playFreeplay(selectedThemeId);
        if (!cancelled) setAudioError(null);
      } catch (err) {
        console.error("[Kairos] SoundscapeEngine error:", err);
        if (!cancelled) setAudioError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isIdle, selectedThemeId, ensureEngine, playFreeplay, isPreviewingSelected]);

  useEffect(() => {
    setBackgroundArt({
      active: freeplayPlaying,
      styleId: theme.visual,
      accentColor: theme.accent,
      holeRadiusRatio: 0,
      seed: SOUND_THEMES.indexOf(theme) + 1,
    });
  }, [theme, freeplayPlaying, setBackgroundArt]);

  const handleSelectTheme = async (id: ThemeId) => {
    setSelectedThemeId(id);
    if (!isIdle) return;
    try {
      await ensureEngine();
      await playFreeplay(id);
      setAudioError(null);
    } catch (err) {
      console.error("[Kairos] SoundscapeEngine error:", err);
      setAudioError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await ensureEngine();
      if (!isPreviewingSelected) await playFreeplay(selectedThemeId);
      setAudioError(null);
      start();
    } catch (err) {
      console.error("[Kairos] SoundscapeEngine error:", err);
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleResumeAudio = async () => {
    setStarting(true);
    try {
      await ensureEngine();
      await playFreeplay(selectedThemeId);
      setAudioError(null);
    } catch (err) {
      console.error("[Kairos] SoundscapeEngine error:", err);
      setAudioError(err instanceof Error ? err.message : String(err));
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

  // Reset は「計測を止めて設定画面に戻る」だけの操作。設定画面では音が鳴り続ける仕様
  // （上の useEffect）なので、ここでは音を止めない。
  const handleReset = () => {
    reset();
  };

  return (
    <div className="relative flex flex-1 items-center justify-center px-8 py-12">
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:items-start lg:justify-center lg:gap-20">
        <div className="flex flex-col items-center gap-8">
          <TimerRing
            progress={(elapsed % RING_LOOP_MS) / RING_LOOP_MS}
            label={statusLabel(state.status)}
            timeLabel={formatStopwatch(elapsed)}
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

          {isIdle && audioSuspended && (
            <p className="max-w-xs text-center text-[11px] text-muted/70">
              🔇 サウンドは準備できています。ブラウザの再生制限のため、画面をどこか一度タップすると鳴り始めます。
            </p>
          )}
          {audioError && <p className="max-w-xs text-center text-[11px] text-red-400">サウンドの再生に失敗しました: {audioError}</p>}
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-8 lg:items-start">
          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">SOUND</p>
              <FocusThemeSelector selectedId={selectedThemeId} onSelect={handleSelectTheme} themes={SOUND_THEMES} />
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
