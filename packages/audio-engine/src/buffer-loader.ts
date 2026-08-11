/**
 * 音源URLを取得して AudioBuffer にデコードする。ブラウザの fetch + decodeAudioData のみに依存する。
 * 同じ URL は同一 AudioContext 内でキャッシュし、二重デコードでメモリを無駄にしない
 * （decodeAudioData の結果は非圧縮 Float32。docs/03_ARCHITECTURE.md ADR-003 の制約2）。
 */
export class BufferLoader {
  private readonly cache = new Map<string, Promise<AudioBuffer>>();

  constructor(private readonly ctx: BaseAudioContext) {}

  load(url: string): Promise<AudioBuffer> {
    let cached = this.cache.get(url);
    if (!cached) {
      cached = fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to fetch audio asset: ${url} (${res.status})`);
          return res.arrayBuffer();
        })
        .then((buf) => this.ctx.decodeAudioData(buf));
      this.cache.set(url, cached);
    }
    return cached;
  }

  async loadAll(urls: readonly string[]): Promise<AudioBuffer[]> {
    return Promise.all(urls.map((u) => this.load(u)));
  }

  /** 使わなくなった素材を解放する（フェーズ切替完了後などに呼ぶ）。 */
  release(url: string): void {
    this.cache.delete(url);
  }

  clear(): void {
    this.cache.clear();
  }
}
