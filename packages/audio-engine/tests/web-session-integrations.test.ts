import { afterEach, describe, expect, it, vi } from "vitest";
import { CLASSIC_PRESET, createIdleState, type TimerState } from "../../core/src";
import { mediaActionFor, mediaSessionSnapshot, shouldHoldWakeLock } from "@/lib/sessionIntegrations";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useMediaSession } from "@/hooks/useMediaSession";

const adapters = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  store: {} as { state: TimerState; resume: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>;
    skip: ReturnType<typeof vi.fn> },
}));

vi.mock("../../../apps/web/node_modules/react", () => ({
  useEffect: (effect: () => void | (() => void)) => adapters.effects.push(effect),
}));
vi.mock("@/hooks/useTimer", () => ({
  useTimerStore: Object.assign(
    (selector: (store: typeof adapters.store) => unknown) => selector(adapters.store),
    { getState: () => adapters.store },
  ),
}));

afterEach(() => {
  adapters.effects.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const phases = ["idle", "focus", "shortBreak", "longBreak", "completed"] as const;

function session(phase: TimerState["phase"], paused: boolean): TimerState {
  return {
    ...createIdleState(CLASSIC_PRESET, 0),
    phase,
    phaseStartedAt: phase === "idle" || phase === "completed" ? null : 0,
    pausedAt: paused ? 0 : null,
  };
}

describe("mediaSessionSnapshot", () => {
  for (const phase of phases) {
    for (const paused of [false, true]) {
      it(`describes ${phase} with paused=${paused}`, () => {
        const state = session(phase, paused);
        const active = phase !== "idle" && phase !== "completed";
        let playbackState = "none";
        if (active) playbackState = paused ? "paused" : "playing";
        const metadata = {
          title: "Kairos",
          artist: phase === "shortBreak" || phase === "longBreak" ? "Break" : "Focus",
          album: "Kairos",
        };
        expect(mediaSessionSnapshot(state)).toEqual({ metadata, playbackState });
        expect(mediaSessionSnapshot({ ...state, taskHeadline: "Write report" })).toEqual({
          metadata: { ...metadata, title: "Write report" }, playbackState,
        });
      });
    }
  }
});

describe("mediaActionFor", () => {
  for (const phase of phases) {
    for (const paused of [false, true]) {
      it(`maps actions in ${phase} with paused=${paused}`, () => {
        const state = session(phase, paused);
        const active = phase !== "idle" && phase !== "completed";
        expect(mediaActionFor("play", state)).toBe(active && paused ? "resume" : null);
        expect(mediaActionFor("pause", state)).toBe(active && !paused ? "pause" : null);
        expect(mediaActionFor("nexttrack", state)).toBe(active ? "skip" : null);
        for (const action of ["stop", "previoustrack", "seekto", "unknown"]) {
          expect(mediaActionFor(action, state)).toBeNull();
        }
      });
    }
  }
});

describe("shouldHoldWakeLock", () => {
  for (const phase of phases) {
    for (const paused of [false, true]) {
      for (const enabled of [false, true]) {
        for (const visible of [false, true]) {
          it(`${phase}, paused=${paused}, enabled=${enabled}, visible=${visible}`, () => {
            const active = phase !== "idle" && phase !== "completed";
            expect(shouldHoldWakeLock(session(phase, paused), enabled, visible))
              .toBe(active && !paused && enabled && visible);
          });
        }
      }
    }
  }

  it("does not hold a lock for a phase that has not started", () => {
    const state = { ...session("focus", false), phaseStartedAt: null };
    expect(shouldHoldWakeLock(state, true, true)).toBe(false);
    expect(mediaSessionSnapshot(state).playbackState).toBe("none");
    expect(mediaActionFor("nexttrack", state)).toBeNull();
  });
});

describe("browser adapters", () => {
  function mountWakeLock(enabled = true) {
    useWakeLock(session("focus", false), enabled);
    return adapters.effects.pop()!();
  }

  function wakeEnvironment() {
    const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const lock = { released: false, release: vi.fn().mockResolvedValue(undefined) };
    const request = vi.fn().mockResolvedValue(lock);
    vi.stubGlobal("document", document);
    vi.stubGlobal("navigator", { wakeLock: { request } });
    const visibility = (value: string) => {
      document.visibilityState = value;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    return { lock, request, visibility };
  }

  it("ignores missing navigator and unsupported browser APIs", () => {
    adapters.store.state = session("focus", false);
    for (const navigator of [undefined, {}]) {
      vi.stubGlobal("navigator", navigator);
      expect(() => mountWakeLock()).not.toThrow();
      useMediaSession();
      expect(() => adapters.effects.pop()!()).not.toThrow();
    }
  });

  it("registers media handlers, reads current state, and clears the session on cleanup", () => {
    const handlers = new Map<string, (() => void) | null>();
    const mediaSession = {
      metadata: null as unknown,
      playbackState: "none",
      setActionHandler: vi.fn((action: string, handler: (() => void) | null) => handlers.set(action, handler)),
    };
    vi.stubGlobal("navigator", { mediaSession });
    vi.stubGlobal("MediaMetadata", class {
      constructor(metadata: object) { Object.assign(this, metadata); }
    });
    adapters.store = {
      state: session("focus", false), resume: vi.fn(), pause: vi.fn(), skip: vi.fn(),
    };
    useMediaSession();
    const cleanup = adapters.effects.pop()!();
    expect(mediaSession.metadata).toEqual({ title: "Kairos", artist: "Focus", album: "Kairos" });
    expect(mediaSession.playbackState).toBe("playing");
    handlers.get("pause")!();
    expect(adapters.store.pause).toHaveBeenCalledOnce();
    adapters.store.state = session("focus", true);
    handlers.get("play")!();
    expect(adapters.store.resume).toHaveBeenCalledOnce();
    handlers.get("nexttrack")!();
    expect(adapters.store.skip).toHaveBeenCalledOnce();
    adapters.store.state = session("idle", false);
    handlers.get("play")!();
    expect(adapters.store.resume).toHaveBeenCalledOnce();
    cleanup!();
    expect([...handlers.values()]).toEqual([null, null, null]);
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
  });

  it("acquires, releases when hidden, reacquires when visible, and cleans up", async () => {
    const { lock, request, visibility } = wakeEnvironment();
    const cleanup = mountWakeLock();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("screen");
    visibility("hidden");
    expect(lock.release).toHaveBeenCalledOnce();
    visibility("visible");
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    cleanup!();
    expect(lock.release).toHaveBeenCalledTimes(2);
    visibility("visible");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("releases a request that finishes after cleanup", async () => {
    const { lock, request } = wakeEnvironment();
    let resolve!: (lock: unknown) => void;
    request.mockReturnValue(new Promise((done) => { resolve = done; }));
    const cleanup = mountWakeLock();
    cleanup!();
    resolve(lock);
    await Promise.resolve();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("releases a stale request without replacing the lock acquired after returning", async () => {
    const { lock, request, visibility } = wakeEnvironment();
    let resolve!: (lock: unknown) => void;
    request.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const cleanup = mountWakeLock();
    visibility("hidden");
    visibility("visible");
    await Promise.resolve();
    const stale = { release: vi.fn().mockResolvedValue(undefined) };
    resolve(stale);
    await Promise.resolve();
    expect(stale.release).toHaveBeenCalledOnce();
    expect(lock.release).not.toHaveBeenCalled();
    cleanup!();
    expect(lock.release).toHaveBeenCalledOnce();
  });

  it("does not request a lock when disabled or initially hidden", () => {
    const { request, visibility } = wakeEnvironment();
    expect(mountWakeLock(false)).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    visibility("hidden");
    const cleanup = mountWakeLock();
    expect(request).not.toHaveBeenCalled();
    cleanup!();
  });

  it("reports acquisition and release failures only through console.warn", async () => {
    const { lock, request } = wakeEnvironment();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    request.mockRejectedValueOnce(new Error("Permission denied"));
    const cleanup = mountWakeLock();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledOnce();
    cleanup!();
    lock.release.mockRejectedValueOnce(new Error("Release failed"));
    const cleanupSecond = mountWakeLock();
    await Promise.resolve();
    cleanupSecond!();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
