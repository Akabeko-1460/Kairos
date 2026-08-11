"use client";

import { DebugPanel } from "@/components/DebugPanel";
import { FocusThemeSelector } from "@/components/FocusThemeSelector";
import { PresetSelector } from "@/components/PresetSelector";
import { RoundIndicator } from "@/components/RoundIndicator";
import { TimerRing } from "@/components/TimerRing";
import { useNow } from "@/hooks/useNow";
import { useSoundscape } from "@/hooks/useSoundscape";
import { useTaskListStore } from "@/hooks/useTaskList";
import { useTimerStore } from "@/hooks/useTimer";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { FOCUS_SOUND_THEMES } from "@/lib/soundThemes";
import { isRunning, progress, remainingMs, type PomodoroPreset } from "@kairos/core";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type KeyboardEvent } from "react";

const buttonMotion = { whileHover: { scale: 1.04 }, whileTap: { scale: 0.95 } } as const;

const FOCUS_ACCENT = "var(--focus-accent)";
const BREAK_ACCENT = "var(--break-accent)";
// GeometricVisualizer は canvas に直接色を描くので CSS 変数ではなく実 hex 値を渡す。
// Focus フェーズ側は選択中のサウンドテーマ（focusTheme.accent）を使うため、break 用のみ残す。
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
  const taskItems = useTaskListStore((s) => s.items);
  const addTaskItem = useTaskListStore((s) => s.addItem);
  const removeTaskItem = useTaskListStore((s) => s.removeItem);
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);
  const now = useNow();
  const [showDebug, setShowDebug] = useState(false);
  const [starting, setStarting] = useState(false);
  // Focus フェーズで鳴らす/描くサウンドテーマ。デフォルトは汎用的な "Work"。
  const [focusThemeId, setFocusThemeId] = useState<string>("work");

  const isIdle = state.phase === "idle" || state.phase === "completed";
  const isBreakPhase = state.phase === "shortBreak" || state.phase === "longBreak";
  const accent = isBreakPhase ? BREAK_ACCENT : FOCUS_ACCENT;

  const focusTheme = FOCUS_SOUND_THEMES.find((t) => t.id === focusThemeId) ?? FOCUS_SOUND_THEMES[0]!;

  // 画面全体（ヘッダーも含む）で共有する背景アートに、このページの状態を反映する。
  // タイマーリングやボタンの配色（focus-accent/break-accent）は変えず、背景アートの
  // 見た目（styleId/accentColor）だけを選択中のサウンドテーマに合わせる。
  useEffect(() => {
    setBackgroundArt({
      active: isRunning(state),
      styleId: isBreakPhase ? "flow" : focusTheme.visual,
      accentColor: isBreakPhase ? BREAK_ACCENT_HEX : focusTheme.accent,
      holeRadiusRatio: 0,
      seed: isBreakPhase ? 2 : 1 + FOCUS_SOUND_THEMES.indexOf(focusTheme),
    });
  }, [state, isBreakPhase, focusTheme, setBackgroundArt]);

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

  // Enter で確定したタスクを箇条書きリストに追加し、入力欄（taskHeadline を下書きとして流用）は空にする。
  const handleAddTaskKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addTaskItem(state.taskHeadline);
    setTaskHeadline("");
  };

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

          <div className="w-full">
            <input
              type="text"
              name="taskHeadline"
              value={state.taskHeadline}
              onChange={(e) => setTaskHeadline(e.target.value)}
              onKeyDown={handleAddTaskKeyDown}
              placeholder="このセッションで取り組むタスクを追加（Enterで追加）"
              className="w-full border-b border-border bg-transparent px-1 py-2 text-center text-sm text-foreground placeholder:text-muted/50 focus:border-foreground focus:outline-none lg:text-left"
            />

            {taskItems.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                <AnimatePresence initial={false}>
                  {taskItems.map((item, index) => (
                    <motion.li
                      key={`${index}-${item}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: "easeOut" }}
                      className="group flex items-center justify-center gap-2 text-sm text-foreground lg:justify-start"
                    >
                      {/* 白い点から始まる箇条書き。 */}
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white" />
                      <span className="flex-1 text-center lg:text-left">{item}</span>
                      <button
                        type="button"
                        onClick={() => removeTaskItem(index)}
                        aria-label={`${item} を削除`}
                        className="shrink-0 text-xs text-muted/0 transition-colors group-hover:text-muted/60 hover:!text-foreground"
                      >
                        ×
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>

          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">PRESET</p>
              <PresetSelector selectedId={state.preset.id} accentColor={accent} onSelect={handleSelectPreset} />
            </div>
          )}

          {isIdle && (
            <div className="w-full">
              <p className="mb-2 text-[10px] tracking-widest text-muted/60">SOUND</p>
              <FocusThemeSelector selectedId={focusThemeId} onSelect={setFocusThemeId} />
            </div>
          )}

          {showDebug && <DebugPanel debugInfo={debugInfo} wallClockNow={now} />}
        </div>
      </div>
    </div>
  );
}
