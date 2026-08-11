import type { Keyframes, PhaseAutomation } from "./types";

/** 純粋関数。キーフレーム間を線形補間する。t は昇順であること。 */
export function valueAt(kf: Keyframes, t: number): number {
  if (kf.length === 0) return 0;
  const first = kf[0]!;
  if (t <= first[0]) return first[1];
  const last = kf[kf.length - 1]!;
  if (t >= last[0]) return last[1];

  for (let i = 0; i < kf.length - 1; i++) {
    const [t0, v0] = kf[i]!;
    const [t1, v1] = kf[i + 1]!;
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return v1;
      const ratio = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * ratio;
    }
  }
  return last[1];
}

/**
 * docs/04_SOUND_ENGINE.md §4.1。
 * Sustain 区間 (0.06–0.85) はほぼ変化しない設計 — ここで音が動くと注意が奪われるため。
 */
export const focusAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.0],
    [0.06, 0.85],
    [0.85, 0.85],
    [0.95, 0.7],
    [1.0, 0.35],
  ],
  texture: [
    [0.0, 0.25],
    [0.1, 0.4],
    [0.85, 0.4],
    [1.0, 0.3],
  ],
  pulse: [
    [0.0, 0.0],
    [0.04, 0.0],
    [0.1, 0.55],
    [0.85, 0.55],
    [0.93, 0.3],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.02],
    [0.12, 0.1],
    [0.8, 0.1],
    [0.9, 0.04],
    [1.0, 0.01],
  ],
  reverbWet: [
    [0.0, 0.35],
    [0.1, 0.22],
    [0.9, 0.22],
    [1.0, 0.45],
  ],
  lowPassHz: [
    [0.0, 1200],
    [0.08, 6000],
    [0.88, 6000],
    [1.0, 2200],
  ],
  breathLfoHz: 0,
  breathDepth: 0,
};

/**
 * docs/04_SOUND_ENGINE.md §4.2。
 * 拍を消すのは意図的 — 休憩に拍があると身体が作業モードを維持してしまう。
 */
export const breakAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.55],
    [0.12, 0.9],
    [0.8, 0.9],
    [1.0, 0.45],
  ],
  texture: [
    [0.0, 0.35],
    [0.15, 0.75],
    [0.8, 0.75],
    [1.0, 0.45],
  ],
  pulse: [
    [0.0, 0.0],
    [0.9, 0.0],
    [1.0, 0.18],
  ],
  cellDensity: [
    [0.0, 0.06],
    [0.2, 0.03],
    [0.85, 0.03],
    [1.0, 0.05],
  ],
  reverbWet: [
    [0.0, 0.45],
    [0.15, 0.65],
    [0.85, 0.65],
    [1.0, 0.4],
  ],
  lowPassHz: [
    [0.0, 3000],
    [0.15, 1800],
    [0.85, 1800],
    [1.0, 3500],
  ],
  breathLfoHz: 0.08, // 音量をゆっくり呼吸させる
  breathDepth: 0.12,
};

export function automationFor(phase: "focus" | "shortBreak" | "longBreak"): PhaseAutomation {
  return phase === "focus" ? focusAutomation : breakAutomation;
}
