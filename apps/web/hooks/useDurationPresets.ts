"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Timer（単発カウントダウン）の分数プリセット。 */
export const BUILTIN_DURATION_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60] as const;

interface DurationPresetsStore {
  /**
   * ユーザーが右クリック削除した分数。ビルトインは定数なので、Pomodoro の
   * `hiddenBuiltinIds`（`usePresets.ts`）と同じく「配列から取り除く」のではなく
   * 「非表示にする」形で削除を表現する。
   */
  hiddenMinutes: number[];
  hideDuration: (minutes: number) => void;
  restoreAll: () => void;
}

export const useDurationPresetsStore = create<DurationPresetsStore>()(
  persist(
    (set) => ({
      hiddenMinutes: [],
      hideDuration: (minutes) =>
        set((s) => (s.hiddenMinutes.includes(minutes) ? s : { hiddenMinutes: [...s.hiddenMinutes, minutes] })),
      restoreAll: () => set({ hiddenMinutes: [] }),
    }),
    { name: "kairos-duration-presets" },
  ),
);

/** 表示すべき分数プリセット（削除されたものを除いたもの）。 */
export function visibleDurationMinutes(hiddenMinutes: readonly number[]): number[] {
  return BUILTIN_DURATION_MINUTES.filter((m) => !hiddenMinutes.includes(m));
}
