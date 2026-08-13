"use client";

import { DeletableChip } from "@/components/DeletableChip";
import { FocusThemeSelector } from "@/components/FocusThemeSelector";
import { NumberInput } from "@/components/NumberInput";
import { TimerRing } from "@/components/TimerRing";
import { VolumeSlider } from "@/components/VolumeSlider";
import { useCountdownStore } from "@/hooks/useCountdown";
import { useDurationPresetsStore, visibleDurationMinutes } from "@/hooks/useDurationPresets";
import { useFreeplay } from "@/hooks/useFreeplay";
import { useNow } from "@/hooks/useNow";
import { usePendingDelete } from "@/hooks/usePendingDelete";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { formatMmSs } from "@/lib/formatTime";
import { TIMER_FINISH_CUE } from "@/lib/soundscapeRuntime";
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

  const {
    engineReady,
    debugInfo,
    freeplayThemeId,
    freeplayPlaying,
    ensureEngine,
    playFreeplay,
    stopFreeplay,
    toggleFreeplayPause,
    masterVolume,
    setMasterVolume,
    playCue,
  } = useFreeplay();
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);

  const hiddenMinutes = useDurationPresetsStore((s) => s.hiddenMinutes);
  const hideDuration = useDurationPresetsStore((s) => s.hideDuration);
  const durationPresets = visibleDurationMinutes(hiddenMinutes);
  const {
    pendingId: pendingDeleteMinutes,
    request: requestDelete,
    clear: clearPendingDelete,
  } = usePendingDelete<number>();

  const [selectedThemeId, setSelectedThemeId] = useState<ThemeId>(SOUND_THEMES[0]!.id);
  const [starting, setStarting] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const running = isCountdownRunning(state);
  const now = useNow(running);
  const isIdle = state.status === "idle" || state.status === "completed";
  const isPreviewingSelected = freeplayPlaying && freeplayThemeId === selectedThemeId;
  // ブラウザの自動再生ポリシーで AudioContext が suspended のまま留め置かれている状態。
  // この画面上の次のクリック/タップで自動的に再開する保険（SoundscapeEngine.armGestureUnlock）
  // が張ってあるので、ここではその間の理由を利用者に示すだけに留める。
  const audioSuspended = engineReady && debugInfo?.contextState === "suspended";

  const theme = SOUND_THEMES.find((t) => t.id === selectedThemeId) ?? SOUND_THEMES[0]!;
  const accent = theme.accent;

  // 残り時間が尽きたら、鳴っている音をフェードアウトさせて completed へ確定させ、
  // 時間になったことをはっきり知らせる。
  // 「setInterval の回数は数えない」の原則通り、判定自体は毎フレーム @kairos/core の
  // 純粋関数（isCountdownFinished）で絶対時刻から再計算する。
  useEffect(() => {
    if (!running) return;
    if (isCountdownFinished(state, now)) {
      syncToNow();
      stopFreeplay();
      // playCue はテーマのフェードバスを通らないので、直前の stopFreeplay()（フェードアウト）に
      // 巻き込まれず鳴り続ける。Pomodoro の「軽い区切り」と違い、席を外していても気づけるよう
      // 繰り返し鳴らす。
      playCue("sessionEnd", TIMER_FINISH_CUE);
    }
  }, [running, state, now, syncToNow, stopFreeplay, playCue]);

  // 設定画面（idle/completed）に入った瞬間から、選択中のサウンドと背景を再生しておく
  // （Home のフリー再生と同じ「選ぶ＝鳴る」体験）。engineReady を待たず、ここで直接
  // ensureEngine() を呼ぶ（既に用意済みなら即resolveするだけなので安全）。TopNav の
  // Timers メニューはクリック時点で先取り初期化もしているが、それに頼り切らずこの
  // 画面自身でも起動できるようにして、Home以外の経路で来ても必ず鳴るようにする。
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

  // カウントダウン中でもサウンドを選び直せる。Timer の再生は Home と同じ freeplay なので、
  // 実行中に選んでもそのままクロスフェードで差し替わる（計測には一切影響しない）。
  const handleSelectTheme = async (id: ThemeId) => {
    setSelectedThemeId(id);
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
      // 設定画面で既に選択中のサウンドをプレビュー再生している場合は、同じテーマへの
      // クロスフェードをもう一度挟まないようにする（無音の谷ができないようにするため）。
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

  // Reset は「カウントダウンを止めて設定画面に戻る」だけの操作。設定画面では音が鳴り続ける
  // 仕様（上の useEffect）なので、ここでは音を止めない。
  const handleReset = () => {
    reset();
  };

  return (
    <div className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8 sm:py-12">
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
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">DURATION</p>
              <div className="flex flex-wrap items-center gap-2">
                {durationPresets.map((min) => (
                  <DeletableChip
                    key={min}
                    label={`${min}分`}
                    active={state.durationMs === min * 60_000}
                    accentColor={accent}
                    // 最後の1つは削除させない（Pomodoro の Preset と同じ方針）。
                    deletable={durationPresets.length > 1}
                    pendingDelete={pendingDeleteMinutes === min}
                    onSelect={() => setDurationMs(min * 60_000)}
                    onRequestDelete={() => requestDelete(min)}
                    onCancelDelete={clearPendingDelete}
                    deleteAriaLabel={`${min}分 を削除`}
                    onConfirmDelete={() => {
                      hideDuration(min);
                      // 消したプリセットを選んでいたら、残りの先頭へ寄せる
                      // （選択が消えたまま宙に浮かないようにする）。
                      if (state.durationMs === min * 60_000) {
                        const fallback = durationPresets.find((m) => m !== min);
                        if (fallback) setDurationMs(fallback * 60_000);
                      }
                      clearPendingDelete();
                    }}
                  />
                ))}
                <label className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted">
                  <NumberInput
                    min={1}
                    max={180}
                    value={Math.round(state.durationMs / 60_000)}
                    onChange={(min) => setDurationMs(min * 60_000)}
                    className="w-10 bg-transparent text-center text-foreground focus:outline-none"
                    aria-label="カスタムの分数"
                  />
                  分
                </label>
              </div>
            </div>
          )}

          {/* SOUND は計測中も操作できる（サウンドの切り替えは計測に影響しない）。 */}
          <div className="w-full">
            <p className="mb-2 text-[10px] tracking-widest text-muted/60">SOUND</p>
            <FocusThemeSelector selectedId={selectedThemeId} onSelect={handleSelectTheme} themes={SOUND_THEMES} />
          </div>

          <div className="w-full max-w-[252px]">
            <VolumeSlider value={masterVolume} onChange={setMasterVolume} accentColor={accent} />
          </div>
        </div>
      </div>
    </div>
  );
}
