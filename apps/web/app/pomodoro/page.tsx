"use client";

import { FocusThemeSelector } from "@/components/FocusThemeSelector";
import { PresetSelector } from "@/components/PresetSelector";
import { RoundIndicator } from "@/components/RoundIndicator";
import { TimerRing } from "@/components/TimerRing";
import { VolumeSlider } from "@/components/VolumeSlider";
import { useNow } from "@/hooks/useNow";
import { useSoundscape } from "@/hooks/useSoundscape";
import { useTaskListStore, type TaskItem } from "@/hooks/useTaskList";
import { useTimerStore } from "@/hooks/useTimer";
import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { formatMmSs } from "@/lib/formatTime";
import { FOCUS_SOUND_THEMES } from "@/lib/soundThemes";
import { isRunning, progress, remainingMs, type PomodoroPreset } from "@kairos/core";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type KeyboardEvent } from "react";

const buttonMotion = { whileHover: { scale: 1.04 }, whileTap: { scale: 0.95 } } as const;

// Focus フェーズの配色は選択中のサウンドテーマ（focusTheme.accent）に委ねるため、
// 固定のアクセントカラーは break 用だけ残す。GeometricVisualizer は canvas に直接色を描くので
// CSS 変数ではなく実 hex 値を渡す。
const BREAK_ACCENT_HEX = "#3fae8e";

interface TaskRowProps {
  item: TaskItem;
  onToggle: () => void;
  onRemove: () => void;
}

function TaskRow({ item, onToggle, onRemove }: TaskRowProps) {
  return (
    <motion.li
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="group flex items-center gap-2 text-sm"
    >
      {/*
        チェックボックスとタスク文をまとめて relative コンテナに入れ、完了時の
        取り消し線をチェックボックスも含めて一直線に引けるようにする
        （文字だけの text-decoration:line-through だとチェックボックスは貫通しない）。
      */}
      <span className="relative flex flex-1 items-center gap-2 overflow-hidden">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={item.done}
          aria-label={item.done ? `${item.text} を未完了に戻す` : `${item.text} を完了にする`}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/70"
        >
          {item.done && (
            <svg
              width={10}
              height={10}
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <span className={`truncate ${item.done ? "text-muted/50" : "text-foreground"}`}>{item.text}</span>
        <motion.span
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-px bg-muted/60"
          style={{ transformOrigin: "left" }}
          initial={false}
          animate={{ width: item.done ? "100%" : "0%" }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        />
      </span>
      {/*
        ×が押しにくいので少し大きくする。文字サイズを上げつつ、
        p-1/-m-1 で見た目の位置・行間は変えずに当たり判定だけ広げる。
      */}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${item.text} を削除`}
        className={`-m-1 shrink-0 rounded p-1 text-base leading-none transition-colors ${
          item.done
            ? "text-red-400 hover:text-red-300"
            : "text-muted/0 group-hover:text-muted/60 hover:!text-foreground"
        }`}
      >
        ×
      </button>
    </motion.li>
  );
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

  const { ensureEngine, engineReady, masterVolume, setMasterVolume, focusThemeId, setFocusThemeId } =
    useSoundscape();
  const taskItems = useTaskListStore((s) => s.items);
  const addTaskItem = useTaskListStore((s) => s.addItem);
  const removeTaskItem = useTaskListStore((s) => s.removeItem);
  const toggleTaskItem = useTaskListStore((s) => s.toggleItem);
  const setBackgroundArt = useBackgroundArtStore((s) => s.setConfig);
  const now = useNow(isRunning(state));
  const [starting, setStarting] = useState(false);

  const isIdle = state.phase === "idle" || state.phase === "completed";
  const isBreakPhase = state.phase === "shortBreak" || state.phase === "longBreak";

  const focusTheme = FOCUS_SOUND_THEMES.find((t) => t.id === focusThemeId) ?? FOCUS_SOUND_THEMES[0]!;
  // Start・Preset・サイクルインジケーターの配色も選択中のサウンドテーマに合わせる。
  // 背景アートだけでなく、Focus フェーズを象徴する色そのものを差し替える。
  const accent = isBreakPhase ? BREAK_ACCENT_HEX : focusTheme.accent;

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
      {/*
        右カラムの先頭行（RoundIndicator）を左のタイマーリング上端に揃えるため、
        行全体を items-start にする（items-center だと2カラムの高さの違いで中央合わせになり、
        右カラムの方が上にズレて見えていた）。
      */}
      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-12 lg:flex-row lg:items-start lg:justify-center lg:gap-20">
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

        <div className="flex w-full max-w-sm flex-col items-center gap-8 lg:items-start">
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
                  {taskItems.map((item) => (
                    <TaskRow
                      key={item.id}
                      item={item}
                      onToggle={() => toggleTaskItem(item.id)}
                      onRemove={() => removeTaskItem(item.id)}
                    />
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

          {/*
            音量バーはSOUNDセクションの直後に置く。isIdleで出し分けず常時表示することで、
            Start前でもタイマー実行中でも操作できるようにする（PRESET/SOUNDが隠れているときは
            自然にその位置へ繰り上がる）。
            幅はHome画面の音量バーと同じにする（Home側は max-w-xs(320px) の行から再生ボタン
            44px・gap-4(16px)・ml-2(8px) を差し引いた 252px がスライダーの実サイズ）。
          */}
          <div className="w-[252px]">
            <VolumeSlider value={masterVolume} onChange={setMasterVolume} accentColor={accent} />
          </div>
        </div>
      </div>
    </div>
  );
}
