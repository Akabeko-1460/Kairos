/**
 * 6つのビジュアルスタイルのバレル。実装はそれぞれ独立したファイルに分割してある
 * （lattice=Study, network=Work, flow=Relax, starfield=Sleep, trails=Move、
 * chronos=Homeの待機状態専用）。
 * このファイルが唯一の公開エントリポイントで、既存の `@/lib/visualStyles` という
 * import パスはそのまま変わらない（ディレクトリ化しても index.ts が解決される）。
 */
export type { Frame, VisualStyle, VisualStyleId } from "./shared";
export { rgba } from "./shared";

export { chronosStyle } from "./chronos";
export { flowStyle } from "./flow";
export { latticeStyle } from "./lattice";
export { networkStyle } from "./network";
export { starfieldStyle } from "./starfield";
export { trailsStyle } from "./trails";

import { chronosStyle } from "./chronos";
import { flowStyle } from "./flow";
import { latticeStyle } from "./lattice";
import { networkStyle } from "./network";
import type { VisualStyle, VisualStyleId } from "./shared";
import { starfieldStyle } from "./starfield";
import { trailsStyle } from "./trails";

export const VISUAL_STYLES: Record<VisualStyleId, VisualStyle<unknown>> = {
  lattice: latticeStyle as VisualStyle<unknown>,
  network: networkStyle as VisualStyle<unknown>,
  flow: flowStyle as VisualStyle<unknown>,
  starfield: starfieldStyle as VisualStyle<unknown>,
  trails: trailsStyle as VisualStyle<unknown>,
  chronos: chronosStyle as VisualStyle<unknown>,
};
