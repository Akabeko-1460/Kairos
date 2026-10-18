"use client";

import {
  changePreset as changePresetTransition,
  CLASSIC_PRESET,
  createIdleState,
  normalizeTimerState,
  pause as pauseTransition,
  reset as resetTransition,
  resume as resumeTransition,
  setAutoContinue as setAutoContinueTransition,
  setTaskHeadline as setTaskHeadlineTransition,
  setTotalRounds as setTotalRoundsTransition,
  skip as skipTransition,
  start as startTransition,
  syncToNowSteps,
  systemClock,
  type PomodoroPreset,
  type TimerState,
} from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { recordsForTransition } from "../lib/sessionRecords";
import { addRecords } from "../lib/sessionRecordStore";

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
  setAutoContinue: (value: boolean) => void;
  syncToNow: () => void;
}

/**
 * docs/02_SPEC.md §5 のタイマー状態を保持する。永続化して、リロード後もセッションを復元する
 * （タスク1-11、F-15）。実際の経過計算は常に @kairos/core の純粋関数を通す。
 */
export const useTimerStore = create<TimerStore>()(
  persist(
    (set, get) => ({
      state: createIdleState(CLASSIC_PRESET, systemClock.now()),
      start: () => set({ state: startTransition(get().state, systemClock.now()) }),
      pause: () => set({ state: pauseTransition(get().state, systemClock.now()) }),
      resume: () => set({ state: resumeTransition(get().state, systemClock.now()) }),
      skip: () => {
        const now = systemClock.now();
        const previous = get().state;
        const next = skipTransition(previous, now);
        set({ state: next });
        void addRecords(recordsForTransition(previous, [next], now, "default"));
      },
      reset: () => {
        const now = systemClock.now();
        const previous = get().state;
        const next = resetTransition(previous, now);
        set({ state: next });
        void addRecords(recordsForTransition(previous, [next], now, "default"));
      },
      setTaskHeadline: (text) => set({ state: setTaskHeadlineTransition(get().state, text) }),
      changePreset: (preset) => set({ state: changePresetTransition(get().state, preset) }),
      setTotalRounds: (n) => set({ state: setTotalRoundsTransition(get().state, n) }),
      setAutoContinue: (value) => set({ state: setAutoContinueTransition(get().state, value) }),
      syncToNow: () => {
        const now = systemClock.now();
        const previous = get().state;
        const steps = syncToNowSteps(previous, now);
        const next = steps.at(-1);
        if (!next) return;
        set({ state: next });
        void addRecords(recordsForTransition(previous, steps, now, "default"));
      },
    }),
    {
      name: "kairos-timer-state",
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<Pick<TimerStore, "state">> | undefined;
        return {
          ...currentState,
          state: persisted?.state ? normalizeTimerState(persisted.state) : currentState.state,
        };
      },
    },
  ),
);
