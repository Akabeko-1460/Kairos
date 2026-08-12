/**
 * docs/CLAUDE.md コーディング規約:
 * 「pulse 素材の loopSeconds × bpm / 60 が整数であることをテストで保証する」。
 * 拍の整数倍でループしないと、ループの度に拍がずれていく。
 */
// packs.json の loopSeconds は手書きの小数（有効数字8桁程度）なので、浮動小数点の丸め誤差を
// 吸収できる程度に緩める。1e-4 は「1拍の1万分の1」に相当し、ズレを見逃す心配はない。
const EPSILON = 1e-4;

/** loopSeconds が bpm に対して拍の整数倍になっているかを判定する純粋関数。 */
export function isPulseLoopAligned(loopSeconds: number, bpm: number): boolean {
  if (bpm <= 0 || loopSeconds <= 0) return false;
  const beats = (loopSeconds * bpm) / 60;
  return Math.abs(beats - Math.round(beats)) < EPSILON;
}

/** 指定した拍数がちょうど収まる loopSeconds を算出する。 */
export function loopSecondsForBeats(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}
