/**
 * docs/04_SOUND_ENGINE.md §4.3 の対照表に対応するスケール（半音インターバル）。
 * Cell の音程はこの中からのみ選ぶ → 何を鳴らしても不協和にならない。
 */
export const SCALES: Readonly<Record<string, readonly number[]>> = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], // Focus 既定（落ち着き）
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], // Break 既定（開放感）
  majorPentatonic: [0, 2, 4, 7, 9],
};

export function scaleSemitones(scaleName: string): readonly number[] {
  const scale = SCALES[scaleName];
  if (!scale) {
    throw new Error(`Unknown scale: ${scaleName}`);
  }
  return scale;
}
