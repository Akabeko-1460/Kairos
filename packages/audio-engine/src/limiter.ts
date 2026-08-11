/**
 * マスターリミッタをインターフェースで抽象化する（docs/04_SOUND_ENGINE.md §9）。
 * 将来 react-native-audio-api に移植する際、DynamicsCompressorNode が未実装のため
 * WaveShaperNode のソフトクリップ曲線で代替する必要がある。差し替えをこのインターフェース経由にする。
 */
export interface Limiter {
  readonly inputNode: AudioNode;
  readonly outputNode: AudioNode;
  dispose(): void;
}

const THRESHOLD_DB = -3;
const KNEE_DB = 0;
const RATIO = 20;
const ATTACK_SEC = 0.003;
const RELEASE_SEC = 0.25;

/** Web 実装。docs/04_SOUND_ENGINE.md §2 のリミッタ設定値。 */
export function createCompressorLimiter(ctx: BaseAudioContext): Limiter {
  const node = ctx.createDynamicsCompressor();
  node.threshold.value = THRESHOLD_DB;
  node.knee.value = KNEE_DB;
  node.ratio.value = RATIO;
  node.attack.value = ATTACK_SEC;
  node.release.value = RELEASE_SEC;
  return {
    inputNode: node,
    outputNode: node,
    dispose() {
      node.disconnect();
    },
  };
}
