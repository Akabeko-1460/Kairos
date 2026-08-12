"use client";

import {
  createIdleCountdown,
  pauseCountdown as pauseTransition,
  resetCountdown as resetTransition,
  resumeCountdown as resumeTransition,
  setCountdownDuration as setDurationTransition,
  startCountdown as startTransition,
  syncCountdownToNow as syncTransition,
  systemClock,
  type CountdownState,
} from "@kairos/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_DURATION_MS = 25 * 60_000; // 25分（Pomodoro Classic の Focus 長に合わせた既定値）

interface CountdownStore {
  state: CountdownState;
  start: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  setDurationMs: (ms: number) => void;
  syncToNow: () => void;
}

/**
 * 「普通のタイマー」（/timer）用。Pomodoro のようなラウンド/休憩は持たない、単発のカウントダウン。
 * `useTimer.ts` と同じ構造（@kairos/core の純粋関数 + persist）。
 */
export const useCountdownStore = create<CountdownStore>()(
  persist(
    (set, get) => ({
      state: createIdleCountdown(DEFAULT_DURATION_MS),
      start: () => set({ state: startTransition(get().state, systemClock.now()) }),
      pause: () => set({ state: pauseTransition(get().state, systemClock.now()) }),
      resume: () => set({ state: resumeTransition(get().state, systemClock.now()) }),
      reset: () => set({ state: resetTransition(get().state) }),
      setDurationMs: (ms) => set({ state: setDurationTransition(get().state, ms) }),
      syncToNow: () =>
        set((s) => {
          const next = syncTransition(s.state, systemClock.now());
          return next === s.state ? s : { state: next };
        }),
    }),
    { name: "kairos-countdown-state" },
  ),
);
