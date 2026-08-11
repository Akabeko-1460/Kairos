"use client";

import { createCustomPreset, type PomodoroPreset } from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PresetsStore {
  customPresets: PomodoroPreset[];
  addCustomPreset: (input: { focusMinutes: number; breakMinutes: number; roundsBeforeLongBreak: number }) => PomodoroPreset;
  removeCustomPreset: (id: string) => void;
}

/** ユーザーが作成したカスタムポモドーロプリセットの永続ストア。ビルトイン(25/5, 50/10)とは別管理。 */
export const usePresetsStore = create<PresetsStore>()(
  persist(
    (set) => ({
      customPresets: [],
      addCustomPreset: (input) => {
        const preset = createCustomPreset(input);
        set((s) => ({ customPresets: [...s.customPresets, preset] }));
        return preset;
      },
      removeCustomPreset: (id) => {
        set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }));
      },
    }),
    { name: "kairos-custom-presets" },
  ),
);
