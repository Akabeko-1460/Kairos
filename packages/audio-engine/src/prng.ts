/**
 * 決定的PRNG（mulberry32）。同一シードから同一系列を返す。
 * CellScheduler や LoopManager のテイク選択に使う（docs/CLAUDE.md: 「CellScheduler は同一シードで
 * 同一系列を返すことをテストで保証する」）。
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
