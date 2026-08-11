"use client";

import { isRunning, systemClock } from "@kairos/core";
import { useEffect, useState } from "react";
import { useTimerStore } from "./useTimer";

/**
 * 表示専用の再描画トリガー。setInterval は UI 更新のためだけに使い、
 * 残り時間そのものは毎回 @kairos/core の progress()/remainingMs() で再計算する
 * （docs/CLAUDE.md: setInterval の回数を数えない）。
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => systemClock.now());
  const running = useTimerStore((s) => isRunning(s.state));

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(systemClock.now()), intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs]);

  return now;
}
