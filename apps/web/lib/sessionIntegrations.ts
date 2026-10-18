import { isActivePhase, isRunning, type TimerState } from "@kairos/core";

export type SessionMediaAction = "resume" | "pause" | "skip";

export function mediaSessionSnapshot(state: TimerState) {
  let playbackState: "playing" | "paused" | "none" = "none";
  if (isRunning(state)) playbackState = "playing";
  else if (isActivePhase(state.phase) && state.pausedAt !== null) playbackState = "paused";

  return {
    metadata: {
      title: state.taskHeadline || "Kairos",
      artist: state.phase === "shortBreak" || state.phase === "longBreak" ? "Break" : "Focus",
      album: "Kairos",
    },
    playbackState,
  };
}

export function mediaActionFor(action: string, state: TimerState): SessionMediaAction | null {
  const { playbackState } = mediaSessionSnapshot(state);
  if (action === "play" && playbackState === "paused") return "resume";
  if (action === "pause" && playbackState === "playing") return "pause";
  if (action === "nexttrack" && playbackState !== "none") return "skip";
  return null;
}

export function shouldHoldWakeLock(state: TimerState, enabled: boolean, visible: boolean): boolean {
  return isRunning(state) && enabled && visible;
}
