/**
 * モードごとに全く異なる「ストーリー性のある」生成アートを描く。
 * 単一の幾何学を動かすだけでなく、複数のパーツ（構造・粒子・波・深度レイヤー等）を組み合わせ、
 * 時間経過で「散らばり→収束→静止→解放」のような明確な物語の起伏を持たせている。
 * Endelの実際のレンダラーやアセットは一切参照しておらず、古典的な生成アート技法
 * （スピログラフ/ハイポトロコイド、フローフィールド、力学風ネットワーク、リサージュ曲線、
 * 星空+視差深度）をゼロから実装したもの。サウンドの周波数データで振幅・速度・明滅を駆動する。
 *
 * このファイルは5つのスタイル実装（./lattice, ./network, ./flow, ./starfield, ./trails）が
 * 共有する型とヘルパーだけを持つ。各スタイル固有のロジックはそれぞれのファイルに閉じている。
 */

export type VisualStyleId = "lattice" | "network" | "flow" | "starfield" | "trails" | "chronos";

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  cx: number;
  cy: number;
  minDim: number;
  maxDim: number;
  t: number; // seconds, monotonic
  dt: number; // seconds since previous frame
  amp: number; // 0..1、平滑化済みの全体振幅
  band: (from: number, to: number) => number; // 0..1、帯域ごとの平均振幅
  rgb: readonly [number, number, number];
  hole: number; // px。TimerRing 等を避けたい場合の内側半径
}

export function rgba([r, g, b]: readonly [number, number, number], a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 物語の時間軸を作るための共通ヘルパー ---
export function easeInOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
export function easeOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - c, 3);
}
/** t を period 秒で 0..1 に正規化する周期位相。 */
export function cyclePhase(t: number, period: number): number {
  const m = t % period;
  return (m < 0 ? m + period : m) / period;
}
/** center を頂点にした三角形のパルス（0..1）。width の範囲外は 0。 */
export function smoothPulse(x: number, center: number, width: number): number {
  const d = Math.abs(x - center);
  return Math.max(0, 1 - d / width);
}

/** 各スタイルの背景クリア方式。'fade' はうっすら塗り重ねて軌跡を残す。 */
export interface VisualStyle<S> {
  clearMode: "clear" | "fade";
  fadeAlpha?: number;
  createState(seed: number): S;
  draw(f: Frame, state: S): void;
}
