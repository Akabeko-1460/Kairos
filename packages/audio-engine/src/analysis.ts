/**
 * レンダリング済み音声バッファの検証ユーティリティ（docs/04_SOUND_ENGINE.md §8）。
 * クロスフェード区間のRMSとクリッピングを OfflineAudioContext のレンダリング結果に対して検証する。
 */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / samples.length);
}

export function rmsWindow(samples: Float32Array, startIdx: number, windowSize: number): number {
  const end = Math.min(samples.length, startIdx + windowSize);
  const start = Math.max(0, startIdx);
  return rms(samples.subarray(start, end));
}

export function toDb(linear: number): number {
  return 20 * Math.log10(Math.max(linear, 1e-12));
}

export function hasClipping(samples: Float32Array, threshold = 1.0): boolean {
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]!) > threshold) return true;
  }
  return false;
}
