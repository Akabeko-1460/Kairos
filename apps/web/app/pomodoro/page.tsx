"use client";

import { DebugPanel } from "@/components/DebugPanel";
import { PresetSelector } from "@/components/PresetSelector";
import { RoundIndicator } from "@/components/RoundIndicator";
import { TimerRing } from "@/components/TimerRing";
import { useNow } from "@/hooks/useNow";
import { useSoundscape } from "@/hooks/useSoundscape";
import { useTimerStore } from "@/hooks/useTimer";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { isRunning, progress, remainingMs, type PomodoroPreset } from "@kairos/core";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const buttonMotion = { whileHover: { scale: 1.04 }, whileTap: { scale: 0.95 } } as const;

const FOCUS_ACCENT = "var(--focus-accent)";
const BREAK_ACCENT = "var(--break-accent)";
// GeometricVisualizer は canvas に直接色を描くので CSS 変数ではなく実 hex 値を渡す。
const FOCUS_ACCENT_HEX = "#4c6ef5";
const BREAK_ACCENT_HEX = "#3fae8e";

function formatMmSs(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "focus":
      return "FOCUS";
    case "shortBreak":
    case "longBreak":
      return "BREAK";
    case "completed":
      return "COMPLETE";
    default:
      return "READY";
  }
}

export default function PomodoroPage() {
  const state = useTimerStore((s) => s.state);
  const start = useTimerStore((s) => s.start);
  const pause = useTimerStore((s) => s.pause);
  const resume = useTimerStore((s) => s.resume);
  const skip = useTimerStore((s) => s.skip);
  const reset = useTimerStore((s) => s.reset);
  const setTaskHeadline = useTimerStore((s) => s.setTaskHeadline);
  const changePreset = useTimerStore((s) => s.changePreset);

  const { ensureEngine, engineReady, debugInfo } = useSoundscape();
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);
  const now = useNow();
  const [showDebug, setShowDebug] = useState(false);
  const [starting, setStarting] = useState(false);

  const isIdle = state.phase === "idle" || state.phase === "completed";
  const isBreakPhase = state.phase === "shortBreak" || state.phase === "longBreak";
  const accent = isBreakPhase ? BREAK_ACCENT : FOCUS_ACCENT;
  const accentHex = isBreakPhase ? BREAK_ACCENT_HEX : FOCUS_ACCENT_HEX;

  // 画面全体（ヘッダーも含む）で共有する背景アートに、このページの状態を反映する。
  useEffect(() => {
    setBackgroundArt({
      active: isRunning(state),
      styleId: isBreakPhase ? "flow" : "network",
      accentColor: accentHex,
      holeRadiusRatio: 0,
      seed: isBreakPhase ? 2 : 1,
    });
  }, [state, isBreakPhase, accentHex, setBackgroundArt]);

  const handleStart = async () => {
    setStarting(true);
    try {
      // AudioContext の生成/resume はユーザー操作起点でなければならない（ADR-003）。
      await ensureEngine();
      start();
    } finally {
      setStarting(false);
    }
  };

  // リロード直後は @kairos/core のタイマー状態は復元されるが、AudioContext は復元できない
  // （自動再生ポリシー、ADR-003）。実行中セッションなのにエンジン未初期化のときはここで拾う。
  const handleResumeAudio = async () => {
    setStarting(true);
    try {
      await ensureEngine();
    } finally {
      setStarting(false);
    }
  };

  const handleSelectPreset = (preset: PomodoroPreset) => changePreset(preset);

  return (
    <div className="relative flex flex-1 items-center justify-center px-8 py-12">
      <button
        type="button"
        onClick={() => setShowDebug((v) => !v)}
        className="absolute right-8 top-6 z-10 text-[10px] tracking-widest text-muted/60 hover:text-muted"
      >
        {showDebug ? "HIDE DEBUG" : "DEBUG"}
      </button>

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:items-center lg:justify-center lg:gap-20">
        <div className="flex flex-col items-center gap-8">
          <TimerRing
            progress={progress(state, now)}
            label={phaseLabel(state.phase)}
            timeLabel={formatMmSs(remainingMs(state, now))}
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
                  onClick={reset}
                  className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                >
                  Reset
                </motion.button>
              </>
            ) : (
              <>
                {state.pausedAt ? (
                  <motion.button
                    {...buttonMotion}
                    type="button"
                    onClick={resume}
                    className="rounded-full px-6 py-2.5 text-sm font-medium text-background"
                    style={{ backgroundColor: accent }}
                  >
                    Resume
                  </motion.button>
                ) : (
                  <motion.button
                    {...buttonMotion}
                    type="button"
                    onClick={pause}
                    className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                  >
                    Pause
                  </motion.button>
                )}
                <motion.button
                  {...buttonMotion}
                  type="button"
                  onClick={skip}
                  className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                >
                  Skip
                </motion.button>
                <motion.button
                  {...buttonMotion}
                  type="button"
                  onClick={reset}
                  className="rounded-full border border-border px-6 py-2.5 text-sm font-medium text-foreground"
                >
                  Reset
                </motion.button>
              </>
            )}
          </div>
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-8 lg:items-start lg:pt-4">
          <RoundIndicator currentRound={state.currentRound} totalRounds={state.totalRounds} accentColor={accent} />

          <input
            type="text"
            name="taskHeadline"
            value={state.taskHeadline}
            onChange={(e) => setTaskHeadline(e.target.value)}
            placeholder="このセッションで取り組むタスク"
            className="w-full border-b border-border bg-transparent px-1 py-2 text-center text-sm text-foreground placeholder:text-muted/50 focus:border-foreground focus:outline-none lg:text-left"
          />

          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">PRESET</p>
              <PresetSelector selectedId={state.preset.id} accentColor={accent} onSelect={handleSelectPreset} />
            </div>
          )}

          {showDebug && <DebugPanel debugInfo={debugInfo} wallClockNow={now} />}
        </div>
      </div>
    </div>
  );
}
