/**
 * シェーダー背景（lib/shaderVisual.ts）と幾何学オーバーレイ（lib/visualStyles.ts）を
 * 同じ「呼吸」で同期させるための共有定数。
 *
 * 単一の正弦波だけだと、周期の谷で画面全体が一斉に暗く/寂しくなる瞬間ができてしまう。
 * そこで周期の異なる3つの波（主周期・その約1/3の中間周期・約2.7倍の長い周期）を重ね、
 * 谷のタイミングをずらすことで「完全に静かになる瞬間」を作らないようにしている。
 * この式は GLSL 側（lib/shaderVisual.ts の FRAGMENT_SRC 内 `story` 変数）と
 * 意図的に同じ係数で複製している。変更する場合は両方を揃えること。
 */
export type StoryStyleId = "lattice" | "network" | "flow" | "starfield" | "trails";

export const STORY_PERIOD_SEC: Record<StoryStyleId, number> = {
  lattice: 21,
  network: 18,
  flow: 24,
  starfield: 28,
  trails: 15,
};

const STORY_BASE = 0.56;
const W1 = 0.26; // 主周期
const W2 = 0.11; // 中間周期（主周期の約1/3。谷を埋める）
const W3 = 0.09; // 長周期（主周期の約2.7倍。ゆっくりとした大きなうねり）

/** シェーダー側のGLSL `story` 変数と同じ式（要・同期）。谷でも0.2程度までしか落ちない。 */
export function storyBreath(t: number, period: number): number {
  const w1 = Math.sin(t * ((2 * Math.PI) / period));
  const w2 = Math.sin(t * ((2 * Math.PI) / (period * 0.33)) + 1.7);
  const w3 = Math.sin(t * ((2 * Math.PI) / (period * 2.7)) + 0.6);
  const value = STORY_BASE + W1 * w1 + W2 * w2 + W3 * w3;
  return Math.max(0.16, Math.min(1.08, value));
}
