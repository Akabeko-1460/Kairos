import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_PRESET, createIdleState, skip, start, type TimerState } from "../../core/src";
import type { useSoundscapeRuntime } from "../../../apps/web/lib/soundscapeRuntime";
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
  vi.spyOn(SoundscapeEngine.prototype, "setMasterVolume").mockImplementation(() => {});
  vi.spyOn(SoundscapeEngine.prototype, "getDebugInfo").mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ packs: [createSoundPack()] }) }));

  runtime = (await import("../../../apps/web/lib/soundscapeRuntime")).useSoundscapeRuntime;
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
