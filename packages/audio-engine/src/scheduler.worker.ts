/**
 * docs/04_SOUND_ENGINE.md §6.1 / Phase 0 スパイクB。
 *
 * タブが非表示になるとメインスレッドの setTimeout/setInterval は毎秒1回以下に絞られる
 * （Chrome では数分後にさらに厳しくなる）。Web Worker 内のタイマーはこの制約を受けにくいため、
 * ここで一定間隔の tick を送り続け、メインスレッド側で「常に2〜3秒先まで」の先読みスケジューリングを行う。
 *
 * このファイル単体では何も判断しない（何を鳴らすかは worker-ticker.ts 経由でメインスレッドが決める）。
 * ティッカーを Worker 側に置く理由はスロットリング回避のみ。
 */
const TICK_INTERVAL_MS = 25;

setInterval(() => {
  postMessage("tick");
}, TICK_INTERVAL_MS);

export {};
