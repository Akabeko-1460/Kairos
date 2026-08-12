import type { Keyframes, PhaseAutomation, ThemeId } from "./types";

/** 純粋関数。キーフレーム間を線形補間する。t は昇順であること。 */
export function valueAt(kf: Keyframes, t: number): number {
  if (kf.length === 0) return 0;
  const first = kf[0]!;
  if (t <= first[0]) return first[1];
  const last = kf[kf.length - 1]!;
  if (t >= last[0]) return last[1];

  for (let i = 0; i < kf.length - 1; i++) {
    const [t0, v0] = kf[i]!;
    const [t1, v1] = kf[i + 1]!;
    if (t >= t0 && t <= t1) {
      if (t1 === t0) return v1;
      const ratio = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * ratio;
    }
  }
  return last[1];
}

/**
 * テーマ別のフェーズ・オートメーション（docs/04_SOUND_ENGINE.md §4）。
 *
 * 各テーマの区間構造（Ease-in / Sustain / Taper / Wind-down、または
 * Release / Rest / Re-engage）自体は共通だが、キーフレームの値は
 * `docs/deep-research-report_chatGPT.md` と `集中力を高める音の文献調査_gemini.md` の
 * 知見をもとにテーマごとに個別設計している（設計根拠は docs/04_SOUND_ENGINE.md の
 * ADR-004 に記載）。
 *
 * **注意**: 実行時に実際に使われるのは `apps/web/public/packs.json` の各テーマの
 * `automation` フィールドであり（`engine.ts` は `pack.themes[...].automation` を直接読む）、
 * ここでのエクスポートは単体テスト用の参照実装 / ドキュメントとしてのミラー。
 * 値を変更する場合は **両方**を同じ値に保つこと（`packs.test.ts` はこの一致まではチェックしない）。
 */

/**
 * Study — 集中型学習・暗記。
 * 根拠: ChatGPT報告 表「作業タイプ依存性」＝一定テンポ・歌詞なし・ピンクノイズ・音量中(40–50dB相当)。
 * Sustain 区間 (0.10–0.85) はほぼ変化しない — ここで音が動くと注意が奪われるため。
 */
export const studyAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.0],
    [0.06, 0.68],
    [0.85, 0.68],
    [0.95, 0.55],
    [1.0, 0.26],
  ],
  texture: [
    [0.0, 0.26],
    [0.1, 0.36],
    [0.85, 0.36],
    [1.0, 0.27],
  ],
  pulse: [
    [0.0, 0.0],
    [0.04, 0.0],
    [0.1, 0.36],
    [0.85, 0.36],
    [0.93, 0.19],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.015],
    [0.12, 0.09],
    [0.8, 0.09],
    [0.9, 0.035],
    [1.0, 0.01],
  ],
  reverbWet: [
    [0.0, 0.28],
    [0.1, 0.2],
    [0.9, 0.2],
    [1.0, 0.38],
  ],
  lowPassHz: [
    [0.0, 1000],
    [0.08, 5400],
    [0.88, 5400],
    [1.0, 1800],
  ],
  breathLfoHz: 0,
  breathDepth: 0,
};

/**
 * Work — デスクワーク全般（ルーチン作業寄り）。
 * 根拠: Gemini報告 表「タスクの性質と推奨音楽特性」＝単純作業は心拍よりやや速いテンポで
 * 交感神経を軽く刺激。Studyより明るいDorianスケール・やや速いテンポ・タイトなリバーブにして
 * 「タスクを前に進める」感覚を出す。
 */
export const workAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.0],
    [0.06, 0.72],
    [0.85, 0.72],
    [0.95, 0.6],
    [1.0, 0.3],
  ],
  texture: [
    [0.0, 0.24],
    [0.1, 0.38],
    [0.85, 0.38],
    [1.0, 0.29],
  ],
  pulse: [
    [0.0, 0.0],
    [0.04, 0.0],
    [0.1, 0.44],
    [0.85, 0.44],
    [0.93, 0.24],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.02],
    [0.12, 0.11],
    [0.8, 0.11],
    [0.9, 0.045],
    [1.0, 0.015],
  ],
  reverbWet: [
    [0.0, 0.24],
    [0.1, 0.2],
    [0.9, 0.2],
    [1.0, 0.34],
  ],
  lowPassHz: [
    [0.0, 1300],
    [0.08, 7200],
    [0.88, 7200],
    [1.0, 2400],
  ],
  breathLfoHz: 0,
  breathDepth: 0,
};

/**
 * Move — 軽い運動・移動中。
 * 根拠: 両報告とも「明るいテンポの音楽が気分と覚醒度を高める」「100–140BPMは単純作業・運動的な
 * 文脈に適する」と指摘。長調（Major Pentatonic）・速いテンポ・ドライな空間で前へ進む推進力を出す。
 */
export const moveAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.13],
    [0.05, 0.64],
    [0.85, 0.64],
    [0.95, 0.51],
    [1.0, 0.26],
  ],
  texture: [
    [0.0, 0.15],
    [0.08, 0.24],
    [0.85, 0.24],
    [1.0, 0.17],
  ],
  pulse: [
    [0.0, 0.0],
    [0.03, 0.0],
    [0.08, 0.58],
    [0.85, 0.58],
    [0.92, 0.34],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.04],
    [0.1, 0.17],
    [0.8, 0.17],
    [0.9, 0.06],
    [1.0, 0.02],
  ],
  reverbWet: [
    [0.0, 0.14],
    [0.08, 0.1],
    [0.9, 0.1],
    [1.0, 0.24],
  ],
  lowPassHz: [
    [0.0, 4000],
    [0.08, 9500],
    [0.88, 9500],
    [1.0, 5000],
  ],
  breathLfoHz: 0,
  breathDepth: 0,
};

const NO_PULSE: Keyframes = [
  [0.0, 0.0],
  [1.0, 0.0],
];

/**
 * Relax — 短い休憩。
 * 根拠: 両報告とも自然音（雨・葉音）がストレスを軽減しソフトファシネーションを提供すると指摘。
 * 拍を消すのは意図的 — 休憩に拍があると身体が作業モードを維持してしまう。
 */
export const relaxAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.47],
    [0.12, 0.77],
    [0.8, 0.77],
    [1.0, 0.38],
  ],
  texture: [
    [0.0, 0.3],
    [0.15, 0.64],
    [0.8, 0.64],
    [1.0, 0.38],
  ],
  pulse: NO_PULSE,
  cellDensity: [
    [0.0, 0.05],
    [0.2, 0.025],
    [0.85, 0.025],
    [1.0, 0.04],
  ],
  reverbWet: [
    [0.0, 0.45],
    [0.15, 0.65],
    [0.85, 0.65],
    [1.0, 0.4],
  ],
  lowPassHz: [
    [0.0, 3000],
    [0.15, 1800],
    [0.85, 1800],
    [1.0, 3500],
  ],
  breathLfoHz: 0.08, // 音量をゆっくり呼吸させる
  breathDepth: 0.12,
};

/**
 * Sleep — 深い休憩・入眠前。
 * 根拠: Gemini報告 §1.1 ブラウンノイズ＝「過覚醒の鎮静・深い没入」。Relaxよりさらに低い
 * ローパス・大きなリバーブ・遅い呼吸LFOにして、覚醒度を最小まで落とす設計にする。
 */
export const sleepAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.51],
    [0.15, 0.81],
    [0.8, 0.81],
    [1.0, 0.47],
  ],
  texture: [
    [0.0, 0.19],
    [0.15, 0.32],
    [0.8, 0.32],
    [1.0, 0.21],
  ],
  pulse: NO_PULSE,
  cellDensity: [
    [0.0, 0.02],
    [0.2, 0.018],
    [0.85, 0.018],
    [1.0, 0.03],
  ],
  reverbWet: [
    [0.0, 0.55],
    [0.15, 0.75],
    [0.85, 0.75],
    [1.0, 0.5],
  ],
  lowPassHz: [
    [0.0, 1600],
    [0.15, 1000],
    [0.85, 1000],
    [1.0, 1800],
  ],
  breathLfoHz: 0.045, // Relax(0.08Hz)よりゆっくりした呼吸（約22秒周期）
  breathDepth: 0.16,
};

const AUTOMATION_BY_THEME: Readonly<Record<ThemeId, PhaseAutomation>> = {
  study: studyAutomation,
  work: workAutomation,
  move: moveAutomation,
  relax: relaxAutomation,
  sleep: sleepAutomation,
};

export function automationFor(theme: ThemeId): PhaseAutomation {
  return AUTOMATION_BY_THEME[theme];
}
