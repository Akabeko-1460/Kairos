"use client";

import { useSoundscapeRuntime } from "@/lib/soundscapeRuntime";

/** Home 画面用の薄いフック。エンジン本体は lib/soundscapeRuntime.ts のシングルトン。 */
export function useFreeplay() {
  const engineReady = useSoundscapeRuntime((s) => s.engineReady);
  const debugInfo = useSoundscapeRuntime((s) => s.debugInfo);
  const freeplayThemeId = useSoundscapeRuntime((s) => s.freeplayThemeId);
  const freeplayPlaying = useSoundscapeRuntime((s) => s.freeplayPlaying);
  const mode = useSoundscapeRuntime((s) => s.mode);
  const ensureEngine = useSoundscapeRuntime((s) => s.ensureEngine);
  const playFreeplay = useSoundscapeRuntime((s) => s.playFreeplay);
  const toggleFreeplayPause = useSoundscapeRuntime((s) => s.toggleFreeplayPause);
  const regenerateFreeplay = useSoundscapeRuntime((s) => s.regenerateFreeplay);
  const stopFreeplay = useSoundscapeRuntime((s) => s.stopFreeplay);
  const masterVolume = useSoundscapeRuntime((s) => s.masterVolume);
  const setMasterVolume = useSoundscapeRuntime((s) => s.setMasterVolume);
  const playCue = useSoundscapeRuntime((s) => s.playCue);
  const cueRinging = useSoundscapeRuntime((s) => s.cueRinging);

  return {
    playCue,
    cueRinging,
    engineReady,
    debugInfo,
    freeplayThemeId,
    freeplayPlaying,
    mode,
    ensureEngine,
    playFreeplay,
    toggleFreeplayPause,
    regenerateFreeplay,
    stopFreeplay,
    masterVolume,
    setMasterVolume,
  };
}
