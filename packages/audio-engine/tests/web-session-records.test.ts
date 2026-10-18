import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLASSIC_PRESET, createIdleState, pause, reset, resume, skip, start, syncToNowSteps,
} from "../../core/src";
import { recordsForTransition } from "../../../apps/web/lib/sessionRecords";
import * as recordStore from "../../../apps/web/lib/sessionRecordStore";

const T0 = 1_000_000;
const focus = () => start(createIdleState(CLASSIC_PRESET, T0, { taskHeadline: "Write" }), T0);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("session records", () => {
  it("records natural focus completion with metadata and a unique id", () => {
    const previous = focus();
    const now = T0 + CLASSIC_PRESET.focusMs;
    const records = recordsForTransition(previous, syncToNowSteps(previous, now), now, "default");
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      id: expect.any(String), startedAt: T0, endedAt: now, phase: "focus",
      plannedMs: CLASSIC_PRESET.focusMs, actualMs: CLASSIC_PRESET.focusMs,
      completed: true, taskHeadline: "Write", soundPackId: "default",
    });
    const again = recordsForTransition(previous, syncToNowSteps(previous, now), now, "default");
    expect(again[0]?.id).not.toBe(records[0]?.id);
  });

  it.each(["skip", "reset", "paused reset"])("excludes pauses from an incomplete %s", (operation) => {
    const paused = pause(focus(), T0 + 1000);
    const previous = operation === "paused reset" ? paused : resume(paused, T0 + 6000);
    const now = T0 + 8000;
    const next = operation === "skip" ? skip(previous, now) : reset(previous, now);
    const records = recordsForTransition(previous, [next], now, "default");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      completed: false, actualMs: operation === "paused reset" ? 1000 : 3000,
      plannedMs: CLASSIC_PRESET.focusMs, startedAt: T0, endedAt: now,
    });
  });

  it("records all three elapsed phases with their original boundaries", () => {
    const previous = focus();
    const firstEnd = T0 + CLASSIC_PRESET.focusMs;
    const breakEnd = firstEnd + CLASSIC_PRESET.shortBreakMs;
    const thirdEnd = breakEnd + CLASSIC_PRESET.focusMs;
    const now = thirdEnd + 1000;
    const records = recordsForTransition(previous, syncToNowSteps(previous, now), now, "default");
    expect(records.map(({ phase, startedAt, endedAt, actualMs, completed }) =>
      [phase, startedAt, endedAt, actualMs, completed])).toEqual([
      ["focus", T0, firstEnd, CLASSIC_PRESET.focusMs, true],
      ["shortBreak", firstEnd, breakEnd, CLASSIC_PRESET.shortBreakMs, true],
      ["focus", breakEnd, thirdEnd, CLASSIC_PRESET.focusMs, true],
    ]);
    expect(new Set(records.map(({ id }) => id)).size).toBe(3);
  });

  it("uses the natural boundary for final completion, including previous pauses", () => {
    const initial = start(createIdleState(CLASSIC_PRESET, T0, { totalRounds: 1 }), T0);
    const previous = resume(pause(initial, T0 + 1000), T0 + 6000);
    const end = T0 + CLASSIC_PRESET.focusMs + 5000;
    const now = end + 100_000;
    expect(recordsForTransition(previous, syncToNowSteps(previous, now), now, "default")[0])
      .toMatchObject({ startedAt: T0, endedAt: end, completed: true, actualMs: CLASSIC_PRESET.focusMs });
  });

  it("does not record pause, resume, unchanged sync, or idle operations", () => {
    const previous = focus();
    const paused = pause(previous, T0 + 1000);
    const now = T0 + 2000;
    const idle = createIdleState(CLASSIC_PRESET, T0);
    expect(recordsForTransition(previous, [paused, resume(paused, now)], now, "default")).toEqual([]);
    expect(recordsForTransition(previous, syncToNowSteps(previous, now), now, "default")).toEqual([]);
    expect(recordsForTransition(idle, [skip(idle, now), reset(idle, now)], now, "default")).toEqual([]);
  });

  it("records a completed focus once while autoContinue waits for resume", () => {
    const previous = start(createIdleState(CLASSIC_PRESET, T0, { autoContinue: false }), T0);
    const now = T0 + 24 * 60 * 60_000;
    const steps = syncToNowSteps(previous, now);
    expect(recordsForTransition(previous, steps, now, "default")).toHaveLength(1);
    const waiting = steps[0]!;
    expect(recordsForTransition(waiting, syncToNowSteps(waiting, now + 1), now + 1, "default")).toEqual([]);
  });
});

describe("session record persistence", () => {
  it.each(["onerror", "onblocked"])("handles an asynchronous open %s", async (event) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const close = vi.fn();
    vi.stubGlobal("indexedDB", { open: () => {
      const request: Record<string, unknown> = { error: new Error("Open failed"), result: { close } };
      queueMicrotask(() => {
        (request[event] as () => void)();
        if (event === "onblocked") (request.onsuccess as () => void)();
      });
      return request;
    } });
    const previous = focus();
    const records = recordsForTransition(previous, [skip(previous, T0 + 1)], T0 + 1, "default");
    await expect(recordStore.addRecords(records)).resolves.toBeUndefined();
    await expect(recordStore.loadRecordsSince(T0)).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(event === "onblocked" ? 2 : 0);
  });

  it("warns without throwing when IndexedDB is unavailable or open throws", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const previous = focus();
    const now = T0 + 1000;
    const records = recordsForTransition(previous, [skip(previous, now)], now, "default");
    vi.stubGlobal("indexedDB", undefined);
    await expect(recordStore.addRecords(records)).resolves.toBeUndefined();
    await expect(recordStore.loadRecordsSince(T0)).resolves.toEqual([]);
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("Denied"); } });
    await expect(recordStore.addRecords(records)).resolves.toBeUndefined();
    await expect(recordStore.loadRecordsSince(T0)).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledTimes(4);
  });

  it("creates the schema, adds a batch, and loads via the startedAt index", async () => {
    const previous = focus();
    const now = T0 + 1000;
    const records = recordsForTransition(previous, [skip(previous, now)], now, "default");
    const createIndex = vi.fn();
    const add = vi.fn();
    const lowerBound = vi.fn().mockReturnValue("range");
    const getAll = vi.fn().mockReturnValue({ result: records });
    const index = vi.fn().mockReturnValue({ getAll });
    const database = {
      createObjectStore: vi.fn().mockReturnValue({ createIndex }),
      close: vi.fn(),
      transaction: vi.fn().mockImplementation(() => {
        const transaction = { objectStore: vi.fn().mockReturnValue({ add, index }), oncomplete: () => {} };
        queueMicrotask(() => transaction.oncomplete());
        return transaction;
      }),
    };
    const open = vi.fn().mockImplementation(() => {
      const request = { result: database, onupgradeneeded: () => {}, onsuccess: () => {} };
      queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
      return request;
    });
    vi.stubGlobal("indexedDB", { open });
    vi.stubGlobal("IDBKeyRange", { lowerBound });
    await recordStore.addRecords(records);
    expect(open).toHaveBeenCalledWith("kairos", 1);
    expect(database.createObjectStore).toHaveBeenCalledWith("sessionRecords", { keyPath: "id" });
    expect(createIndex).toHaveBeenCalledWith("startedAt", "startedAt");
    expect(database.transaction).toHaveBeenCalledWith("sessionRecords", "readwrite");
    expect(add).toHaveBeenCalledWith(records[0]);
    await expect(recordStore.loadRecordsSince(T0)).resolves.toEqual(records);
    expect(database.transaction).toHaveBeenCalledWith("sessionRecords", "readonly");
    expect(index).toHaveBeenCalledWith("startedAt");
    expect(lowerBound).toHaveBeenCalledWith(T0);
    expect(getAll).toHaveBeenCalledWith("range");
    expect(database.close).toHaveBeenCalledTimes(2);
  });

  it("swallows transaction aborts and closes the connection", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const database = {
      close: vi.fn(),
      transaction: () => {
        const transaction = {
          error: new Error("Aborted"), onabort: () => {},
          objectStore: () => ({ add: vi.fn(), index: () => ({ getAll: () => ({}) }) }),
        };
        queueMicrotask(() => transaction.onabort());
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", { open: () => {
      const request = { result: database, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    } });
    vi.stubGlobal("IDBKeyRange", { lowerBound: vi.fn() });
    const previous = focus();
    const records = recordsForTransition(previous, [skip(previous, T0 + 1)], T0 + 1, "default");
    await expect(recordStore.addRecords(records)).resolves.toBeUndefined();
    await expect(recordStore.loadRecordsSince(T0)).resolves.toEqual([]);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(database.close).toHaveBeenCalledTimes(2);
  });
});

describe("timer store integration", () => {
  it("persists sync, skip, and reset once each without recording pause/resume", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
    const add = vi.spyOn(recordStore, "addRecords").mockResolvedValue();
    const { useTimerStore } = await import("../../../apps/web/hooks/useTimer");
    useTimerStore.setState({ state: focus() });
    vi.setSystemTime(T0 + CLASSIC_PRESET.focusMs);
    useTimerStore.getState().syncToNow();
    useTimerStore.getState().syncToNow();
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0]?.[0][0]).toMatchObject({ phase: "focus", completed: true, soundPackId: "default" });
    vi.setSystemTime(T0 + CLASSIC_PRESET.focusMs + 1000);
    useTimerStore.getState().pause();
    vi.setSystemTime(T0 + CLASSIC_PRESET.focusMs + 6000);
    useTimerStore.getState().resume();
    useTimerStore.getState().skip();
    expect(add.mock.calls[1]?.[0][0]).toMatchObject({ phase: "shortBreak", actualMs: 1000, completed: false });
    vi.setSystemTime(T0 + CLASSIC_PRESET.focusMs + 7000);
    useTimerStore.getState().reset();
    expect(add.mock.calls[2]?.[0][0]).toMatchObject({ phase: "focus", actualMs: 1000, completed: false });
    expect(add).toHaveBeenCalledTimes(3);
    expect(useTimerStore.getState().state.phase).toBe("idle");
  });
});
