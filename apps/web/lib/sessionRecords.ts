import { elapsedMs, isActivePhase, phaseDurationMs, type SessionRecord, type TimerState } from "@kairos/core";

/** 終了したフェーズだけを記録する。pause/resume や設定変更では記録しない。 */
export function recordsForTransition(
  prev: TimerState,
  steps: readonly TimerState[],
  now: number,
  soundPackId: string,
): SessionRecord[] {
  const records: SessionRecord[] = [];
  let previous = prev;
  for (const next of steps) {
    const phaseChanged = next.phase !== previous.phase || next.currentRound !== previous.currentRound ||
      next.phaseStartedAt !== previous.phaseStartedAt;
    if (
      isActivePhase(previous.phase) &&
      previous.phaseStartedAt !== null &&
      phaseChanged
    ) {
      const plannedMs = phaseDurationMs(previous);
      const isReset = next.phase === "idle";
      // completed/idle は開始時刻を持たないため、直前の状態から終了時刻を求める。
      let endedAt = next.phaseStartedAt ?? now;
      if (!isReset && next.phaseStartedAt === null && previous.pausedAt === null &&
        elapsedMs(previous, now) >= plannedMs) {
        endedAt = previous.phaseStartedAt + previous.accumulatedPauseMs + plannedMs;
      }
      const actualMs = Math.min(plannedMs, elapsedMs(previous, endedAt));
      records.push({
        id: globalThis.crypto?.randomUUID?.() ?? `${endedAt}-${Math.random().toString(36).slice(2)}`,
        startedAt: previous.phaseStartedAt,
        endedAt,
        phase: previous.phase,
        plannedMs,
        actualMs,
        completed: !isReset && actualMs >= plannedMs,
        taskHeadline: previous.taskHeadline,
        soundPackId,
      });
    }
    previous = next;
  }
  return records;
}
