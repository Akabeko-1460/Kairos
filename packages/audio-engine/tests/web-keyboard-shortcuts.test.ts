import { afterEach, describe, expect, it, vi } from "vitest";
import { shortcutAction, type ShortcutInput, type ShortcutStatus } from "@/lib/keyboardShortcuts";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

const adapters = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  settings: { keyboardShortcutsEnabled: true },
  store: {
    state: { phase: "idle", pausedAt: null as number | null },
    pause: vi.fn(), resume: vi.fn(), skip: vi.fn(),
  },
}));

vi.mock("../../../apps/web/node_modules/react", () => ({
  useEffect: (effect: () => void | (() => void)) => adapters.effects.push(effect),
  useRef: (current: boolean) => ({ current }),
}));
vi.mock("@/hooks/useTimer", () => ({ useTimerStore: { getState: () => adapters.store } }));
vi.mock("@/lib/settingsStore", () => ({ useSettingsStore: { getState: () => adapters.settings } }));

const space: ShortcutInput = {
  key: " ", code: "Space", repeat: false,
  ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  targetTag: "BODY", isContentEditable: false,
};
const statuses: ShortcutStatus[] = ["idle", "running", "paused"];

afterEach(() => {
  adapters.effects.length = 0;
  adapters.settings.keyboardShortcutsEnabled = true;
  adapters.store.state = { phase: "idle", pausedAt: null };
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("shortcutAction", () => {
  it.each([
    ["idle", "start"], ["running", "pause"], ["paused", "resume"],
  ] as const)("maps Space in %s to %s", (status, action) => {
    expect(shortcutAction(space, status)).toBe(action);
    expect(shortcutAction({ ...space, code: "" }, status)).toBe(action);
    expect(shortcutAction({ ...space, key: "" }, status)).toBe(action);
  });

  it.each(statuses)("maps N only during an active session: %s", (status) => {
    for (const key of ["n", "N"]) {
      expect(shortcutAction({ ...space, key, code: "KeyN" }, status))
        .toBe(status === "idle" ? null : "skip");
    }
  });

  it.each([
    { targetTag: "input" }, { targetTag: "TEXTAREA" }, { targetTag: "select" },
    { isContentEditable: true }, { ctrlKey: true }, { metaKey: true },
    { altKey: true }, { shiftKey: true }, { repeat: true },
  ])("ignores editing, modifiers, and repeated keys: %j", (override) => {
    for (const status of statuses) {
      for (const input of [space, { ...space, key: "n", code: "KeyN" }]) {
        expect(shortcutAction({ ...input, ...override }, status)).toBeNull();
      }
    }
  });

  it.each(["Enter", "Escape", "r", "ArrowRight"])("ignores unrelated key %s", (key) => {
    for (const status of statuses) {
      expect(shortcutAction({ ...space, key, code: key }, status)).toBeNull();
    }
  });
});

describe("useKeyboardShortcuts", () => {
  function mount(handleStart = vi.fn().mockResolvedValue(undefined)) {
    const window = new EventTarget();
    class Element extends EventTarget {
      tagName = "BODY";
      isContentEditable = false;
    }
    vi.stubGlobal("window", window);
    vi.stubGlobal("HTMLElement", Element);
    useKeyboardShortcuts(handleStart);
    const cleanup = adapters.effects.pop()!();
    const press = (overrides: Record<string, unknown> = {}) => {
      const event = new Event("keydown", { cancelable: true });
      Object.assign(event, space, { isComposing: false });
      for (const [name, value] of Object.entries(overrides)) {
        Object.defineProperty(event, name, { value, configurable: true });
      }
      window.dispatchEvent(event);
      return event;
    };
    return { press, cleanup, handleStart, Element };
  }

  it("starts synchronously, prevents Space scrolling, and removes its listener", () => {
    const { press, handleStart, cleanup } = mount();
    expect(press().defaultPrevented).toBe(true);
    expect(handleStart).toHaveBeenCalledOnce();
    cleanup!();
    expect(press().defaultPrevented).toBe(false);
    expect(handleStart).toHaveBeenCalledOnce();
  });

  it("uses current settings without remounting", () => {
    const { press, handleStart } = mount();
    adapters.settings.keyboardShortcutsEnabled = false;
    expect(press().defaultPrevented).toBe(false);
    expect(handleStart).not.toHaveBeenCalled();
    adapters.settings.keyboardShortcutsEnabled = true;
    press();
    expect(handleStart).toHaveBeenCalledOnce();
  });

  it("uses current phase and pause state, including pausedAt zero and completion", () => {
    const { press, handleStart } = mount();
    for (const phase of ["focus", "shortBreak", "longBreak"]) {
      adapters.store.state = { phase, pausedAt: null };
      expect(press().defaultPrevented).toBe(true);
      adapters.store.state.pausedAt = 0;
      press();
      expect(press({ key: "n", code: "KeyN" }).defaultPrevented).toBe(false);
    }
    expect(adapters.store.pause).toHaveBeenCalledTimes(3);
    expect(adapters.store.resume).toHaveBeenCalledTimes(3);
    expect(adapters.store.skip).toHaveBeenCalledTimes(3);
    adapters.store.state = { phase: "completed", pausedAt: null };
    press({ key: "n", code: "KeyN" });
    expect(adapters.store.skip).toHaveBeenCalledTimes(3);
    press();
    expect(handleStart).toHaveBeenCalledOnce();
  });

  it("leaves editing, composition, repeats, and handled events alone", () => {
    const { press, handleStart, Element } = mount();
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      const target = Object.assign(new Element(), { tagName });
      expect(press({ target }).defaultPrevented).toBe(false);
    }
    const target = Object.assign(new Element(), { isContentEditable: true });
    expect(press({ target }).defaultPrevented).toBe(false);
    expect(press({ isComposing: true }).defaultPrevented).toBe(false);
    expect(press({ repeat: true }).defaultPrevented).toBe(false);
    expect(press({ ctrlKey: true }).defaultPrevented).toBe(false);
    press({ defaultPrevented: true });
    expect(handleStart).not.toHaveBeenCalled();
  });

  it("suppresses another start while audio initialization is pending", async () => {
    let resolve!: () => void;
    const handleStart = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const { press } = mount(handleStart);
    press();
    press();
    expect(handleStart).toHaveBeenCalledOnce();
    resolve();
    await Promise.resolve();
    press();
    expect(handleStart).toHaveBeenCalledTimes(2);
    resolve();
    await Promise.resolve();
  });
});
