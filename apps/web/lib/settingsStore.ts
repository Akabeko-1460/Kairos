import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

export interface Settings {
  cueEnabled: boolean;
  notificationsEnabled: boolean;
  wakeLockEnabled: boolean;
  keyboardShortcutsEnabled: boolean;
  theme: "dark" | "light";
  layerTrims: { pad: number; texture: number; pulse: number; cell: number };
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function sanitizeTrim(raw: unknown): number {
  if (typeof raw !== "number" || Number.isNaN(raw)) return 1;
  return Math.min(1, Math.max(0, raw));
}

/** 保存済みの古い設定や不正な値を、現在の設定に補完・正規化する。 */
export function sanitizeSettings(raw: unknown): Settings {
  const settings = asRecord(raw);
  const trims = asRecord(settings.layerTrims);
  return {
    cueEnabled: typeof settings.cueEnabled === "boolean" ? settings.cueEnabled : true,
    notificationsEnabled: typeof settings.notificationsEnabled === "boolean" ? settings.notificationsEnabled : false,
    wakeLockEnabled: typeof settings.wakeLockEnabled === "boolean" ? settings.wakeLockEnabled : true,
    keyboardShortcutsEnabled:
      typeof settings.keyboardShortcutsEnabled === "boolean" ? settings.keyboardShortcutsEnabled : true,
    theme: settings.theme === "light" ? "light" : "dark",
    layerTrims: {
      pad: sanitizeTrim(trims.pad),
      texture: sanitizeTrim(trims.texture),
      pulse: sanitizeTrim(trims.pulse),
      cell: sanitizeTrim(trims.cell),
    },
  };
}

// SSR やブラウザの保存制限下でも、メモリ上の設定は更新できるようにする。
const settingsStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // 保存できない場合はメモリ上だけで保持する。
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // 保存制限下では削除も不要。
    }
  },
};

interface SettingsStore extends Settings {
  setCueEnabled: (enabled: boolean) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setWakeLockEnabled: (enabled: boolean) => void;
  setKeyboardShortcutsEnabled: (enabled: boolean) => void;
  setTheme: (theme: Settings["theme"]) => void;
  setLayerTrim: (layer: keyof Settings["layerTrims"], value: number) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...sanitizeSettings(null),
      setCueEnabled: (cueEnabled) => set({ cueEnabled }),
      setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
      setWakeLockEnabled: (wakeLockEnabled) => set({ wakeLockEnabled }),
      setKeyboardShortcutsEnabled: (keyboardShortcutsEnabled) => set({ keyboardShortcutsEnabled }),
      setTheme: (theme) => set({ theme }),
      setLayerTrim: (layer, value) =>
        set((state) => ({
          layerTrims: { ...state.layerTrims, [layer]: sanitizeTrim(value) },
        })),
    }),
    {
      name: "kairos-settings",
      storage: createJSONStorage(() => settingsStorage),
      partialize: (state) => sanitizeSettings(state),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
    },
  ),
);
