"use client";

import { systemClock } from "@kairos/core";
import { useEffect, useState } from "react";

/**
 * 表示専用の再描画トリガー。setInterval は UI 更新のためだけに使い、
 * 残り時間そのものは毎回 @kairos/core の progress()/remainingMs() 等で再計算する
 * （docs/CLAUDE.md: setInterval の回数を数えない）。
 *
 * Pomodoro/Timer/Stopwatch のどれからも使う汎用フックなので、「動いているか」は
 * 呼び出し側の状態機械（isRunning 系の判定）から渡してもらう。
 */
export function useNow(running: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => systemClock.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(systemClock.now()), intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs]);

  return now;
}
