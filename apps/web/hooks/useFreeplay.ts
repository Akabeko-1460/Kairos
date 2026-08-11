"use client";

import { useSoundscapeRuntime } from "@/lib/soundscapeRuntime";

/** Home 画面用の薄いフック。エンジン本体は lib/soundscapeRuntime.ts のシングルトン。 */
export function useFreeplay() {
  const engineReady = useSoundscapeRuntime((s) => s.engineReady);
  const freeplayPhase = useSoundscapeRuntime((s) => s.freeplayPhase);
  const freeplayCategoryId = useSoundscapeRuntime((s) => s.freeplayCategoryId);
  const freeplayPlaying = useSoundscapeRuntime((s) => s.freeplayPlaying);
  const mode = useSoundscapeRuntime((s) => s.mode);
  const ensureEngine = useSoundscapeRuntime((s) => s.ensureEngine);
  const playFreeplay = useSoundscapeRuntime((s) => s.playFreeplay);
  const toggleFreeplayPause = useSoundscapeRuntime((s) => s.toggleFreeplayPause);
  const regenerateFreeplay = useSoundscapeRuntime((s) => s.regenerateFreeplay);
  const stopFreeplay = useSoundscapeRuntime((s) => s.stopFreeplay);
  const setMasterVolume = useSoundscapeRuntime((s) => s.setMasterVolume);

  return {
    engineReady,
    freeplayPhase,
    freeplayCategoryId,
    freeplayPlaying,
    mode,
    ensureEngine,
    playFreeplay,
    toggleFreeplayPause,
    regenerateFreeplay,
    stopFreeplay,
    setMasterVolume,
  };
}
