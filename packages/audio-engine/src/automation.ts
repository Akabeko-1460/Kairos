import type { Keyframes } from "./types";

/**
 * キーフレーム列の線形補間（純粋関数）。t は昇順であること。
 *
 * **テーマ別のオートメーション値そのものは `apps/web/public/packs.json` にある。**
 * 各 `ThemeSoundDefinition` が自分の `automation` を内包しており（ADR-004 のデータ駆動設計）、
 * `engine.ts` は `pack.themes[...].automation` を直接読む。
 *
 * 以前はこのファイルにも5テーマ分の同じ値を「単体テスト用の参照実装 / ミラー」として
 * 二重に持っていたが、両方を手で同期し続ける前提は実際には守られず relax が乖離していた
 * （packs.json 側だけが更新され、テストは出荷されない側を検証していた）。
 * 出荷されるデータをそのまま検証する方が正確なので、ミラーは廃止して
 * `packs.test.ts` が packs.json を直接読んで検証する形に一本化した。
 */
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
