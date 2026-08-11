/**
 * 等パワークロスフェードカーブ（docs/04_SOUND_ENGINE.md §6.4 / Phase 0 スパイクA）。
 *
 * 線形フェードは中間で音圧が落ち込んで「谷」ができるため使わない。
 * sin/cos を使うと sin(x)^2 + cos(x)^2 = 1 が恒等式として常に成り立つため、
 * 2つの信号の実効振幅（RMS）が等しい前提で重ね合わせたときの合成パワーが
 * クロスフェード区間全体で一定に保たれる。
 */
export function equalPowerCurve(fadeIn: boolean, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);
    curve[i] = fadeIn ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }
  return curve;
}

/** 0..1 の位置 x における fade-out/fade-in ゲイン係数を直接計算する（テストや事前検証用）。 */
export function equalPowerGainAt(x: number, fadeIn: boolean): number {
  const clamped = Math.min(1, Math.max(0, x));
  return fadeIn ? Math.sin((clamped * Math.PI) / 2) : Math.cos((clamped * Math.PI) / 2);
}

/** 2つの等パワーゲインを合成したときの相対パワー（sin^2 + cos^2）。理想値は常に1。 */
export function combinedPowerAt(x: number): number {
  const out = equalPowerGainAt(x, false);
  const inn = equalPowerGainAt(x, true);
  return out * out + inn * inn;
}
