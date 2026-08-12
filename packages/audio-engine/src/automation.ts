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

/**
 * Relax — 短い休憩。
 * 根拠: 両報告とも自然音（雨・葉音）がストレスを軽減しソフトファシネーションを提供すると指摘。
 * 拍(=作業的なキック)を排したのは意図的だが、rev.3.6（ADR-008）で「音楽性をある程度」持たせる
 * ため、柔らかい旋律アルペジオ(pulseレイヤー)を追加した。deep-research-report_relux_chatGPT.md:
 * 「反復性や予測可能性が高いリズムが安定感を高める」「60–80BPM・柔らかく単純な旋律」。
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
  pulse: [
    [0.0, 0.0],
    [0.12, 0.0],
    [0.25, 0.32],
    [0.8, 0.32],
    [1.0, 0.14],
  ],
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
 * Sleep — 深い休憩・入眠。
 * rev.3.6（ADR-008）で全面再設計。deep-research-report_relux_chatGPT.md の中心的な知見:
 * 「ピンクノイズ50dBの継続再生でREM睡眠が約19分短縮した」「就寝後はタイマーで停止し
 * 静寂/耳栓へ移行するのが望ましい」。したがって t=0.42 以降（後述）は"別の音"を鳴らすのではなく、
 * 継続的な刺激から遠ざかり静寂に近づいていく設計にした。
 *
 * フェーズ構成（Home のフリー再生では 100分を仮想セッション長として実時間で進む。
 * apps/web/lib/soundscapeRuntime.ts の SLEEP_VIRTUAL_DURATION_SEC 参照）:
 *   t 0.00–0.05  Release   — 静かに始まる
 *   t 0.05–0.35  Onset     — 入眠用の音（最初40分）。柔らかい旋律アルペジオ(pulse)を含め
 *                             「音楽性をある程度」持たせる。反復的で予測可能な短いフレーズ
 *   t 0.35–0.42  （40分の境界。onset→deepへなめらかに移行）
 *   t 0.42–1.00  Deep      — 睡眠をより深くするための音。pulse/cellはほぼ消え、
 *                             pad/textureも継続的に音量を下げ、リバーブは遠く・暗くなっていく。
 *                             t=1.0 以降は自動化が t=1.0 の値で頭打ちになり、その静かな状態を
 *                             一晩中保持し続ける（t は Math.min(1, ...) でクランプされるため）
 */
export const sleepAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.35],
    [0.05, 0.75],
    [0.35, 0.7],
    [0.42, 0.4],
    [0.65, 0.18],
    [1.0, 0.15],
  ],
  texture: [
    [0.0, 0.15],
    [0.05, 0.3],
    [0.35, 0.28],
    [0.42, 0.16],
    [0.65, 0.08],
    [1.0, 0.07],
  ],
  pulse: [
    [0.0, 0.0],
    [0.05, 0.0],
    [0.1, 0.3],
    [0.32, 0.3],
    [0.4, 0.0],
    [1.0, 0.0],
  ],
  cellDensity: [
    [0.0, 0.02],
    [0.05, 0.035],
    [0.35, 0.03],
    [0.42, 0.006],
    [1.0, 0.004],
  ],
  reverbWet: [
    [0.0, 0.5],
    [0.1, 0.68],
    [0.4, 0.72],
    [0.42, 0.8],
    [1.0, 0.85],
  ],
  lowPassHz: [
    [0.0, 1500],
    [0.1, 1100],
    [0.35, 1050],
    [0.42, 750],
    [1.0, 600],
  ],
  breathLfoHz: 0.035, // Relax(0.08Hz)よりさらにゆっくりした呼吸（約29秒周期）
  breathDepth: 0.14,
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
