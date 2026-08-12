"use client";

import {
  changePreset as changePresetTransition,
  createIdleState,
  pause as pauseTransition,
  reset as resetTransition,
  resume as resumeTransition,
  setTaskHeadline as setTaskHeadlineTransition,
  setTotalRounds as setTotalRoundsTransition,
  skip as skipTransition,
  start as startTransition,
  STANDARD_PRESET,
  syncToNow as syncToNowTransition,
  systemClock,
  type PomodoroPreset,
  type TimerState,
} from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TimerStore {
  state: TimerState;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  reset: () => void;
  setTaskHeadline: (text: string) => void;
  changePreset: (preset: PomodoroPreset) => void;
  setTotalRounds: (n: number) => void;
  syncToNow: () => void;
}

/**
 * docs/02_SPEC.md §5 のタイマー状態を保持する。永続化して、リロード後もセッションを復元する
 * （タスク1-11、F-15）。実際の経過計算は常に @kairos/core の純粋関数を通す。
 */
export const useTimerStore = create<TimerStore>()(
  persist(
    (set, get) => ({
      state: createIdleState(STANDARD_PRESET, systemClock.now()),
      start: () => set({ state: startTransition(get().state, systemClock.now()) }),
      pause: () => set({ state: pauseTransition(get().state, systemClock.now()) }),
      resume: () => set({ state: resumeTransition(get().state, systemClock.now()) }),
      skip: () => set({ state: skipTransition(get().state, systemClock.now()) }),
      reset: () => set({ state: resetTransition(get().state, systemClock.now()) }),
      setTaskHeadline: (text) => set({ state: setTaskHeadlineTransition(get().state, text) }),
      changePreset: (preset) => set({ state: changePresetTransition(get().state, preset) }),
      setTotalRounds: (n) => set({ state: setTotalRoundsTransition(get().state, n) }),
      syncToNow: () =>
        set((s) => {
          const next = syncToNowTransition(s.state, systemClock.now());
          return next === s.state ? s : { state: next };
        }),
    }),
    { name: "kairos-timer-state" },
  ),
);
