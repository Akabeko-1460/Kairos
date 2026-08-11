/**
 * タイマーの経過計算はすべて `Clock` 経由で「今」を取得する。
 * `Date.now()` を直接呼ばないことで、テストで時刻を固定できる（docs/CLAUDE.md コーディング規約）。
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/** テスト用の可変クロック。advance() で時刻を進める。 */
export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  set(ms: number): void {
    this.current = ms;
  }
}
