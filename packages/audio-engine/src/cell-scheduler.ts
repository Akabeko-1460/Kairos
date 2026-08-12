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
      pan: (this.rng() * 2 - 1) * 0.6,
      // 全体的な音量調整の一環で -15% ほど下げてある(旧: 0.5–0.85)。
      gain: 0.43 + this.rng() * 0.3,
    };
  }

  /** 次回発火時刻を density に基づいて進め、その時刻を返す。 */
  advance(density: number): number {
    this.nextAt += this.nextInterval(density);
    return this.nextAt;
  }
}
