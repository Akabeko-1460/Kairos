"use client";

import { createCustomPreset, type PomodoroPreset } from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface PresetsStore {
  customPresets: PomodoroPreset[];
  /** ユーザーが右クリック削除したビルトインプリセット(classic/deep)のid。ビルトインは定数なので
   *  配列から取り除くのではなく「非表示にする」形で削除を表現する。 */
  hiddenBuiltinIds: string[];
  addCustomPreset: (input: { focusMinutes: number; breakMinutes: number; roundsBeforeLongBreak: number }) => PomodoroPreset;
  removeCustomPreset: (id: string) => void;
  hideBuiltinPreset: (id: string) => void;
}

/** ユーザーが作成したカスタムポモドーロプリセットの永続ストア。ビルトイン(25/5, 50/10)とは別管理。 */
export const usePresetsStore = create<PresetsStore>()(
  persist(
    (set) => ({
      customPresets: [],
      hiddenBuiltinIds: [],
      addCustomPreset: (input) => {
        const preset = createCustomPreset(input);
        set((s) => ({ customPresets: [...s.customPresets, preset] }));
        return preset;
      },
      removeCustomPreset: (id) => {
        set((s) => ({ customPresets: s.customPresets.filter((p) => p.id !== id) }));
      },
      hideBuiltinPreset: (id) => {
        set((s) => (s.hiddenBuiltinIds.includes(id) ? s : { hiddenBuiltinIds: [...s.hiddenBuiltinIds, id] }));
      },
    }),
    { name: "kairos-custom-presets" },
  ),
);
