import type { Rng } from "./prng";

/** docs/04_SOUND_ENGINE.md §6.5。 */
export interface CellEvent {
  readonly semitone: number;
  readonly pan: number;
  readonly gain: number;
}

export class CellScheduler {
  private nextAt: number;

  constructor(
    private readonly rng: Rng,
    private readonly scaleSemitones: readonly number[],
    startTime: number,
  ) {
    // 開始直後の発火は唐突なので、フェーズ開始から最低5秒のオフセットを入れる。
    this.nextAt = startTime + 5;
  }

  get nextEventTime(): number {
    return this.nextAt;
  }

  /** density は「毎秒の期待発火数」。ポアソン過程 = 間隔が指数分布。 */
  nextInterval(density: number): number {
    if (density <= 0) return Number.POSITIVE_INFINITY;
    return -Math.log(1 - this.rng()) / density;
  }

  pick(): CellEvent {
    const idx = Math.floor(this.rng() * this.scaleSemitones.length);
    const st = this.scaleSemitones[idx]!;
    return {
      semitone: st + (this.rng() < 0.5 ? 0 : 12),
      // docs/03_ARCHITECTURE.md ADR-005: 固定式空間オーディオは動的トラッキングより疲労が少ない
      // という知見（PMC8829886 で参照される空間オーディオ研究）に倣い、Cell は元々ループ中
      // 動かない定位だが、幅そのものも左右へ飛びすぎない範囲(旧 ±0.6 → ±0.4)に狭めて
      // 落ち着いた印象にする。
      pan: (this.rng() * 2 - 1) * 0.4,
      // Endel Science（"stimulate concentration without pulling you away from the task"）:
      // Cell はあくまで背景の彩りであり主役ではない。もう一段控えめにする(旧: 0.43–0.73)。
      gain: 0.36 + this.rng() * 0.24,
    };
  }

  /** 次回発火時刻を density に基づいて進め、その時刻を返す。 */
  advance(density: number): number {
    this.nextAt += this.nextInterval(density);
    return this.nextAt;
  }
}
