"use client";

import {
  createIdleStopwatch,
  pauseStopwatch as pauseTransition,
  resetStopwatch as resetTransition,
  resumeStopwatch as resumeTransition,
  startStopwatch as startTransition,
  systemClock,
  type StopwatchState,
} from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StopwatchStore {
  state: StopwatchState;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
}

/** /stopwatch 用。@kairos/core の純粋関数 + persist（useTimer.ts と同じ構造）。 */
export const useStopwatchStore = create<StopwatchStore>()(
  persist(
    (set, get) => ({
      state: createIdleStopwatch(),
      start: () => set({ state: startTransition(get().state, systemClock.now()) }),
      pause: () => set({ state: pauseTransition(get().state, systemClock.now()) }),
      resume: () => set({ state: resumeTransition(get().state, systemClock.now()) }),
      reset: () => set({ state: resetTransition() }),
    }),
    { name: "kairos-stopwatch-state" },
  ),
);
