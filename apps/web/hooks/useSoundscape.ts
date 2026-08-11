"use client";

import { useEffect } from "react";
import { useSoundscapeRuntime, type EngineDebugInfo } from "@/lib/soundscapeRuntime";

export type { EngineDebugInfo };

/**
 * Pomodoro 画面用の薄いフック。実体は `lib/soundscapeRuntime.ts` のモジュール単位シングルトン。
 * ページ遷移（Home ⇄ Pomodoro）をまたいでも AudioContext を再生成しないための設計。
 */
export function useSoundscape() {
  const ensureEngine = useSoundscapeRuntime((s) => s.ensureEngine);
  const switchToTimerMode = useSoundscapeRuntime((s) => s.switchToTimerMode);
  const engineReady = useSoundscapeRuntime((s) => s.engineReady);
  const debugInfo = useSoundscapeRuntime((s) => s.debugInfo);

  useEffect(() => {
    switchToTimerMode();
  }, [switchToTimerMode]);

  return { ensureEngine, engineReady, debugInfo };
}
