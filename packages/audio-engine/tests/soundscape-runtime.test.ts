import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_PRESET, createIdleState, skip, start, type TimerState } from "../../core/src";
import type { useSoundscapeRuntime } from "../../../apps/web/lib/soundscapeRuntime";

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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ packs: [{ id: "test" }] }) }));

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
