import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_PRESET, createIdleState, skip, start, type TimerState } from "../../core/src";
import type { useSoundscapeRuntime } from "../../../apps/web/lib/soundscapeRuntime";
import type { useSettingsStore } from "../../../apps/web/lib/settingsStore";
import { createSoundPack } from "./fixtures/sound-pack";

const timerStore = vi.hoisted(() => ({
  state: null as TimerState | null,
  syncToNow: vi.fn(),
}));

vi.mock("@/hooks/useTimer", () => ({
  useTimerStore: { getState: () => timerStore },
}));

vi.mock("@/lib/environment", () => ({
  fetchWeatherCategory: vi.fn().mockResolvedValue(null),
}));

let runtime: typeof useSoundscapeRuntime;
let transitionSpy: ReturnType<typeof vi.spyOn>;
let volumeSpy: ReturnType<typeof vi.spyOn>;
let cueSpy: ReturnType<typeof vi.spyOn>;
let settings: typeof useSettingsStore;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
  timerStore.state = start(createIdleState(CLASSIC_PRESET, Date.now()), Date.now());
  timerStore.syncToNow.mockClear();

  const { SoundscapeEngine } = await import("../src/engine");
  vi.spyOn(SoundscapeEngine.prototype, "init").mockResolvedValue(undefined);
  vi.spyOn(SoundscapeEngine.prototype, "loadPack").mockResolvedValue(undefined);
  vi.spyOn(SoundscapeEngine.prototype, "begin").mockResolvedValue(undefined);
  transitionSpy = vi.spyOn(SoundscapeEngine.prototype, "transitionTo").mockResolvedValue(undefined);
  vi.spyOn(SoundscapeEngine.prototype, "tick").mockImplementation(() => {});
  volumeSpy = vi.spyOn(SoundscapeEngine.prototype, "setMasterVolume").mockImplementation(() => {});
  cueSpy = vi.spyOn(SoundscapeEngine.prototype, "playCue").mockResolvedValue(undefined);
  vi.spyOn(SoundscapeEngine.prototype, "getDebugInfo").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ packs: [createSoundPack()] }) }));

  runtime = (await import("../../../apps/web/lib/soundscapeRuntime")).useSoundscapeRuntime;
  settings = (await import("../../../apps/web/lib/settingsStore")).useSettingsStore;
  settings.getState().setCueEnabled(true);
  await runtime.getState().ensureEngine();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startPomodoroAudio(): Promise<void> {
  runtime.getState().switchToTimerMode();
  await vi.advanceTimersByTimeAsync(100);
}

describe("Web runtime mute", () => {
  it("mutes and restores the selected master volume", () => {
    runtime.getState().setMasterVolume(0.37);
    volumeSpy.mockClear();

    runtime.getState().toggleMute();
    expect(runtime.getState().muted).toBe(true);
    expect(runtime.getState().masterVolume).toBe(0.37);
    expect(volumeSpy).toHaveBeenNthCalledWith(1, 0);

    runtime.getState().toggleMute();
    expect(runtime.getState().muted).toBe(false);
    expect(volumeSpy).toHaveBeenNthCalledWith(2, 0.37);
    expect(volumeSpy).toHaveBeenCalledTimes(2);
  });

  it("unmutes when the master volume changes", () => {
    runtime.getState().toggleMute();
    volumeSpy.mockClear();

    runtime.getState().setMasterVolume(0.52);

    expect(runtime.getState().muted).toBe(false);
    expect(runtime.getState().masterVolume).toBe(0.52);
    expect(volumeSpy).toHaveBeenCalledExactlyOnceWith(0.52);
  });

  it("applies mute selected before engine initialization", async () => {
    vi.resetModules();
    const { SoundscapeEngine } = await import("../src/engine");
    vi.spyOn(SoundscapeEngine.prototype, "init").mockResolvedValue(undefined);
    vi.spyOn(SoundscapeEngine.prototype, "loadPack").mockResolvedValue(undefined);
    const initialVolume = vi.spyOn(SoundscapeEngine.prototype, "setMasterVolume").mockImplementation(() => {});
    const freshRuntime = (await import("../../../apps/web/lib/soundscapeRuntime")).useSoundscapeRuntime;

    expect(freshRuntime.getState().muted).toBe(false);
    freshRuntime.getState().setMasterVolume(0.41);
    freshRuntime.getState().toggleMute();
    await freshRuntime.getState().ensureEngine();

    expect(initialVolume).toHaveBeenCalledExactlyOnceWith(0);
    freshRuntime.getState().toggleMute();
    expect(initialVolume).toHaveBeenLastCalledWith(0.41);
  });
});

describe("Web runtime cue controls", () => {
  it.each(["phaseEnd", "sessionEnd"] as const)("plays enabled %s cues", (kind) => {
    runtime.getState().playCue(kind);
    expect(cueSpy).toHaveBeenCalledExactlyOnceWith(kind, undefined);
  });

  it.each(["disabled", "muted"] as const)("suppresses explicit cues when %s", (reason) => {
    if (reason === "disabled") settings.getState().setCueEnabled(false);
    else runtime.getState().toggleMute();

    runtime.getState().playCue("phaseEnd");
    runtime.getState().playCue("sessionEnd", { bursts: 4 });

    expect(cueSpy).not.toHaveBeenCalled();
    expect(runtime.getState().cueRinging).toBe(false);
  });

  it.each(["enabled", "disabled", "muted"] as const)(
    "honors %s cues during Pomodoro phase and session completion",
    async (mode) => {
      await startPomodoroAudio();
      if (mode === "disabled") settings.getState().setCueEnabled(false);
      if (mode === "muted") runtime.getState().toggleMute();

      timerStore.syncToNow.mockImplementationOnce(() => {
        timerStore.state = skip(timerStore.state!, Date.now());
      });
      await vi.advanceTimersByTimeAsync(100);

      if (mode === "enabled") {
        expect(cueSpy).toHaveBeenCalledExactlyOnceWith("phaseEnd", { gain: 0.45 });
      } else {
        expect(cueSpy).not.toHaveBeenCalled();
      }
      expect(transitionSpy).toHaveBeenCalledWith("relax", timerStore.state!.sessionSeed, 3);
      cueSpy.mockClear();

      timerStore.syncToNow.mockImplementationOnce(() => {
        timerStore.state = { ...timerStore.state!, phase: "completed" };
      });
      await vi.advanceTimersByTimeAsync(100);

      if (mode === "enabled") {
        expect(cueSpy).toHaveBeenCalledExactlyOnceWith("sessionEnd", {
          gain: 0.6, bursts: 2, burstIntervalSec: 1.1,
        });
      } else {
        expect(cueSpy).not.toHaveBeenCalled();
      }
    },
  );
});

describe("Web runtime crossfade duration", () => {
  it("uses 3s when changing the Focus theme during Pomodoro", async () => {
    await startPomodoroAudio();
    runtime.getState().setFocusThemeId("work");
    await vi.advanceTimersByTimeAsync(100);

    expect(transitionSpy).toHaveBeenCalledExactlyOnceWith("work", timerStore.state!.sessionSeed, 3);
  });

  it("uses 3s when switching Pomodoro phases", async () => {
    await startPomodoroAudio();
    timerStore.state = skip(timerStore.state!, Date.now());
    await vi.advanceTimersByTimeAsync(100);

    expect(transitionSpy).toHaveBeenCalledExactlyOnceWith("relax", timerStore.state.sessionSeed, 3);
  });

  it("uses 3s for the existing early phase transition", async () => {
    await startPomodoroAudio();
    vi.setSystemTime(timerStore.state!.phaseStartedAt! + CLASSIC_PRESET.focusMs * 0.99);
    await vi.advanceTimersByTimeAsync(100);

    expect(transitionSpy).toHaveBeenCalledExactlyOnceWith("relax", timerStore.state!.sessionSeed, 3);
  });

  it("uses 3s when regenerating freeplay audio", async () => {
    await runtime.getState().playFreeplay("study");
    runtime.getState().regenerateFreeplay();

    expect(transitionSpy).toHaveBeenCalledExactlyOnceWith("study", Date.now(), 3);
  });
});

describe("Web runtime pack validation", () => {
  it("propagates validation errors, resets playback, and allows retrying", async () => {
    vi.resetModules();
    const { SoundPackError, SoundscapeEngine } = await import("../src");
    const loadPack = vi.spyOn(SoundscapeEngine.prototype, "loadPack").mockResolvedValue(undefined);
    vi.spyOn(SoundscapeEngine.prototype, "init").mockResolvedValue(undefined);
    vi.spyOn(SoundscapeEngine.prototype, "begin").mockResolvedValue(undefined);
    vi.spyOn(SoundscapeEngine.prototype, "setMasterVolume").mockImplementation(() => {});
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce({
      json: async () => ({ packs: [{ id: "broken" }] }),
    } as Response);
    runtime = (await import("../../../apps/web/lib/soundscapeRuntime")).useSoundscapeRuntime;

    const playback = runtime.getState().playFreeplay("study");
    await expect(playback).rejects.toBeInstanceOf(SoundPackError);
    await expect(playback).rejects.toThrow("packs[0].name");
    expect(logError).toHaveBeenCalled();
    expect(runtime.getState().engineReady).toBe(false);
    expect(runtime.getState().freeplayPlaying).toBe(false);
    expect(loadPack).not.toHaveBeenCalled();

    await runtime.getState().playFreeplay("study");
    expect(runtime.getState().engineReady).toBe(true);
    expect(runtime.getState().freeplayPlaying).toBe(true);
    expect(loadPack).toHaveBeenCalledExactlyOnceWith(createSoundPack());
  });
});
