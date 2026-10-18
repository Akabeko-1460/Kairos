import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeSettings, useSettingsStore } from "@/lib/settingsStore";

const defaults = {
  cueEnabled: true,
  notificationsEnabled: false,
  wakeLockEnabled: true,
  keyboardShortcutsEnabled: true,
  theme: "dark",
  layerTrims: { pad: 1, texture: 1, pulse: 1, cell: 1 },
};

beforeEach(() => {
  vi.stubGlobal("localStorage", undefined);
  useSettingsStore.setState(sanitizeSettings(null));
});

afterEach(() => vi.unstubAllGlobals());

describe("sanitizeSettings", () => {
  it.each([{}, null, undefined, [], "settings", 123, {
    cueEnabled: "false",
    notificationsEnabled: 1,
    wakeLockEnabled: null,
    keyboardShortcutsEnabled: [],
    theme: true,
    layerTrims: { pad: "0.5", texture: null, pulse: false, cell: [] },
  }])("fills missing or incorrectly typed settings: %j", (raw) => {
    expect(sanitizeSettings(raw)).toEqual(defaults);
  });

  it("preserves all valid settings", () => {
    const settings = {
      cueEnabled: false,
      notificationsEnabled: true,
      wakeLockEnabled: false,
      keyboardShortcutsEnabled: false,
      theme: "light",
      layerTrims: { pad: 0, texture: 0.2, pulse: 0.6, cell: 1 },
    };
    expect(sanitizeSettings(settings)).toEqual(settings);
  });

  it("clamps trims and defaults NaN and unsupported themes", () => {
    expect(sanitizeSettings({
      theme: "system",
      layerTrims: { pad: -1, texture: 2, pulse: NaN, cell: 0.5 },
    })).toEqual({ ...defaults, layerTrims: { pad: 0, texture: 1, pulse: 1, cell: 0.5 } });
    expect(sanitizeSettings({ layerTrims: { pad: -Infinity, texture: Infinity } }).layerTrims)
      .toEqual({ pad: 0, texture: 1, pulse: 1, cell: 1 });
  });

  it("completes partial trims without sharing mutable defaults", () => {
    const settings = sanitizeSettings({ layerTrims: { pad: 0.3 } });
    expect(settings.layerTrims).toEqual({ pad: 0.3, texture: 1, pulse: 1, cell: 1 });
    settings.layerTrims.cell = 0;
    expect(sanitizeSettings(null)).toEqual(defaults);
  });
});

describe("useSettingsStore", () => {
  it("updates every setting without localStorage", () => {
    const store = useSettingsStore.getState();
    expect(() => {
      store.setCueEnabled(false);
      store.setNotificationsEnabled(true);
      store.setWakeLockEnabled(false);
      store.setKeyboardShortcutsEnabled(false);
      store.setTheme("light");
      store.setLayerTrim("pad", 0.2);
      store.setLayerTrim("texture", 0.4);
      store.setLayerTrim("pulse", 0.6);
      store.setLayerTrim("cell", 0.8);
    }).not.toThrow();
    expect(sanitizeSettings(useSettingsStore.getState())).toEqual({
      cueEnabled: false,
      notificationsEnabled: true,
      wakeLockEnabled: false,
      keyboardShortcutsEnabled: false,
      theme: "light",
      layerTrims: { pad: 0.2, texture: 0.4, pulse: 0.6, cell: 0.8 },
    });
  });

  it("normalizes trim updates", () => {
    const store = useSettingsStore.getState();
    store.setLayerTrim("pad", -0.5);
    store.setLayerTrim("texture", 4);
    store.setLayerTrim("pulse", NaN);
    expect(useSettingsStore.getState().layerTrims).toEqual({ pad: 0, texture: 1, pulse: 1, cell: 1 });
  });

  it("saves only settings under kairos-settings and restores validated values", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    useSettingsStore.getState().setTheme("light");
    expect(JSON.parse(saved.get("kairos-settings")!)).toEqual({
      state: { ...defaults, theme: "light" }, version: 0,
    });
    saved.set("kairos-settings", JSON.stringify({
      state: { theme: "invalid", notificationsEnabled: true, layerTrims: { pad: -1, cell: 0.4 } },
      version: 0,
    }));
    await useSettingsStore.persist.rehydrate();
    expect(sanitizeSettings(useSettingsStore.getState())).toEqual({
      ...defaults, notificationsEnabled: true, layerTrims: { pad: 0, texture: 1, pulse: 1, cell: 0.4 },
    });
    expect(typeof useSettingsStore.getState().setTheme).toBe("function");
    saved.set("kairos-settings", JSON.stringify({ state: null, version: 0 }));
    await useSettingsStore.persist.rehydrate();
    expect(sanitizeSettings(useSettingsStore.getState())).toEqual(defaults);
  });

  it("keeps updates usable when browser storage throws", async () => {
    const denied = () => { throw new Error("Storage unavailable"); };
    vi.stubGlobal("localStorage", { getItem: denied, setItem: denied, removeItem: denied });
    await expect(useSettingsStore.persist.rehydrate()).resolves.toBeUndefined();
    expect(() => useSettingsStore.getState().setCueEnabled(false)).not.toThrow();
    expect(useSettingsStore.getState().cueEnabled).toBe(false);
  });
});
