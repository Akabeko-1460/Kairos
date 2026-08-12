"use client";

import { useSoundscapeRuntime, type EngineDebugInfo } from "@/lib/soundscapeRuntime";

export type { EngineDebugInfo };

/**
 * Pomodoro 画面用の薄いフック。実体は `lib/soundscapeRuntime.ts` のモジュール単位シングルトン。
 * ページ遷移（Home ⇄ Pomodoro）をまたいでも AudioContext を再生成しないための設計。
 *
 * 以前はマウント時に無条件で switchToTimerMode() を呼んでいたが、それだと Start 前の
 * 設定画面（idle/completed）でも「timer」モード扱いになってしまい、TimerState 駆動の
 * 再生ロジック（フェーズが idle だと無音）しか選べず、Timer/Stopwatch と同じ
 * 「選ぶ＝鳴る」のフリー再生プレビューを出せなかった（＝Pomodoroだけ設定画面で音が
 * 鳴らないバグの実体）。switchToTimerMode は呼び出し側（Pomodoro ページ）が
 * Start を押した瞬間、あるいはリロード直後から実行中セッションを引き継ぐ瞬間にだけ呼ぶ。
 */
export function useSoundscape() {
  const ensureEngine = useSoundscapeRuntime((s) => s.ensureEngine);
  const switchToTimerMode = useSoundscapeRuntime((s) => s.switchToTimerMode);
  const engineReady = useSoundscapeRuntime((s) => s.engineReady);
  const debugInfo = useSoundscapeRuntime((s) => s.debugInfo);
  const masterVolume = useSoundscapeRuntime((s) => s.masterVolume);
  const setMasterVolume = useSoundscapeRuntime((s) => s.setMasterVolume);
  const focusThemeId = useSoundscapeRuntime((s) => s.focusThemeId);
  const setFocusThemeId = useSoundscapeRuntime((s) => s.setFocusThemeId);

  return {
    ensureEngine,
    switchToTimerMode,
    engineReady,
    debugInfo,
    masterVolume,
    setMasterVolume,
    focusThemeId,
    setFocusThemeId,
  };
}
