/**
 * バックグラウンドタブでも止まらない先読みスケジューリングの駆動役（Phase 0 スパイクB）。
 * 本番のブラウザでは必ず WorkerTicker を使うこと。setTimeout 直結は禁止（docs/CLAUDE.md）。
 */
export interface Ticker {
  start(onTick: () => void): void;
  stop(): void;
  readonly isRunning: boolean;
}

/** ブラウザの Web Worker で駆動するティッカー。 */
export class WorkerTicker implements Ticker {
  private worker: Worker | null = null;

  start(onTick: () => void): void {
    if (this.worker) return;
    // Next.js / webpack / turbopack の module worker 記法。
    // eslint 等の静的解析で警告が出る場合があるが、Web Audio 系プロジェクトの標準パターン。
    this.worker = new Worker(new URL("./scheduler.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = () => onTick();
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  get isRunning(): boolean {
    return this.worker !== null;
  }
}

/**
 * Worker が使えない環境（Vitest/Node、SSR時の型チェックなど）向けのフォールバック。
 * **本番のブラウザ実装では絶対に使わないこと** — setTimeout はバックグラウンドタブでスロットリングされる。
 */
export class IntervalTicker implements Ticker {
  private handle: ReturnType<typeof setInterval> | null = null;

  start(onTick: () => void): void {
    if (this.handle) return;
    this.handle = setInterval(onTick, 25);
  }

  stop(): void {
    if (this.handle) clearInterval(this.handle);
    this.handle = null;
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }
}
