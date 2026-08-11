/**
 * シェーダー背景（lib/shaderVisual.ts）と幾何学オーバーレイ（lib/visualStyles.ts）を
 * 同じ「呼吸」で同期させるための共有定数。周期だけでなく波形（0.62 + 0.38*sin）も
 * 両レイヤーで完全に一致させることで、2つの描画技術が別々のエフェクトの重ね合わせではなく
 * 単一の作品として融合して見えるようにする。
 */
export type StoryStyleId = "lattice" | "network" | "flow" | "starfield" | "trails";

export const STORY_PERIOD_SEC: Record<StoryStyleId, number> = {
  lattice: 21,
  network: 18,
  flow: 24,
  starfield: 28,
  trails: 15,
};

const STORY_BASE = 0.62;
const STORY_SWING = 0.38;

/** シェーダー側のGLSL `story` 変数と同じ式。0まで落ちきらないので消失しない。 */
export function storyBreath(t: number, period: number): number {
  return STORY_BASE + STORY_SWING * Math.sin(t * ((2 * Math.PI) / period));
}
