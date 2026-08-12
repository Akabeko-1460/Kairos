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
 * **ADR-009 で全テーマを再設計**した。旧設計（rev.3系）は Study/Work がほぼ同じ構造
 * （どちらも打楽器的な pulse を持つだけ）で使い分けが分かりにくく、Move も Study/Work と
 * 同じ「ゆっくりイーズイン→サステイン→テーパー」の弧をテンポだけ変えて流用していた。
 * Relax は reverbWet の大きな振れ幅と Pad Ensemble のドリフト（旧: 深さ0.45、ADR-006）が
 * 組み合わさって「リバーブがずっと上下に呼吸するように膨らんでは萎む」不快な唸りを生んでいた
 * （ユーザー報告。根本原因は `phase-graph.ts` の `PAD_DRIFT_DEPTH` にあり、そちらは
 * 0.45→0.18 に縮小済み。Relax/Sleep のオートメーションはさらに振れ幅を抑えて二重に対策した）。
 *
 * 今回は Endel の公開設計方針（endel.io/science, endel.io/focus, endel.io/activity,
 * endel.io/relax）を参照し、テーマごとに「役割」を明確に分けた:
 *
 * | テーマ | Endel的な位置づけ | 拍(pulse)の性格 |
 * |---|---|---|
 * | Study | Reading — 言語処理のための没入。**規則的な拍を持たない** | 拍ではなく極めて疎らな一音（余韻） |
 * | Work | Deep Work — 規則的な拍が集中の持続を助ける | キック+ハイハット+柔らかいコンピング動機のグルーヴ |
 * | Move | Activity — 運動のケイデンスに同調する、完全に別物のリズム | キック+スネア+ハイハットの実際のドラムパターン |
 * | Relax | Relax — "simple sound structures... no beat... easy to process" | 拍ではなく柔らかい旋律(ADR-008)。振れ幅を抑制 |
 * | Sleep | Sleep — 入眠→深い睡眠でだんだん静寂に近づく(ADR-008) | 入眠帯のみの疎らな旋律。振れ幅を抑制 |
 *
 * **注意**: 実行時に実際に使われるのは `apps/web/public/packs.json` の各テーマの
 * `automation` フィールドであり（`engine.ts` は `pack.themes[...].automation` を直接読む）、
 * ここでのエクスポートは単体テスト用の参照実装 / ドキュメントとしてのミラー。
 * 値を変更する場合は **両方**を同じ値に保つこと（`packs.test.ts` はこの一致まではチェックしない）。
 */

/**
 * Study — 読書・参考書での学習（言語処理・黙読が中心）。
 * 根拠: Endel の "Read" は規則的な拍を持たない没入型サウンドスケープ。読解は言語処理そのもの
 * であり、外部リズムは音楽的な予測処理と競合しうる（ADR-007 で既出の知見）。
 * したがって pulse 層は「拍」ではなく、8拍に1音だけ鳴る極めて疎らな一音（`generateArpeggioPulse`
 * を極端に間引いた設定）にし、聴取者が拍として認識しない密度にした（ADR-009）。
 * 主役は Pad（静かな一定和音）とピンクノイズによるマスキングで、Sustain 区間 (0.15–0.85) は
 * ほぼ変化しない — ここで音が動くと注意が奪われるため。
 */
export const studyAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.0],
    [0.06, 0.78],
    [0.85, 0.78],
    [0.95, 0.62],
    [1.0, 0.3],
  ],
  texture: [
    [0.0, 0.24],
    [0.1, 0.34],
    [0.85, 0.34],
    [1.0, 0.25],
  ],
  pulse: [
    [0.0, 0.0],
    [0.08, 0.0],
    [0.15, 0.16],
    [0.85, 0.16],
    [0.93, 0.08],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.012],
    [0.12, 0.07],
    [0.8, 0.07],
    [0.9, 0.03],
    [1.0, 0.008],
  ],
  reverbWet: [
    [0.0, 0.22],
    [0.1, 0.16],
    [0.9, 0.16],
    [1.0, 0.32],
  ],
  lowPassHz: [
    [0.0, 900],
    [0.08, 4800],
    [0.88, 4800],
    [1.0, 1600],
  ],
};

/**
 * Work — PC作業/仕事、および作曲・ライティングなどの創造的作業。
 * 根拠: endel.io の "Deep Work" — 「規則的な拍がフロー状態の持続を助ける」という Endel の
 * 公開方針そのままに、Study とは対照的に**明確な拍を持たせる**（ADR-009 の核）。
 * pulse 層はキック+オフビートハイハット+柔らかいコンピング動機（`generateGroovePulse`）で、
 * 単なるメトロノームではなく短い音楽的フレーズが乗るグルーヴにした。Pad は ADR-007 の
 * 木質ボディ共鳴を維持し、Endel "Deep Work" の "smooth ... string, keyboard and wood notes,
 * immersive background harmony" に寄せている。
 */
export const workAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.0],
    [0.06, 0.74],
    [0.85, 0.74],
    [0.95, 0.6],
    [1.0, 0.3],
  ],
  texture: [
    [0.0, 0.22],
    [0.1, 0.36],
    [0.85, 0.36],
    [1.0, 0.27],
  ],
  pulse: [
    [0.0, 0.0],
    [0.04, 0.0],
    [0.1, 0.42],
    [0.85, 0.42],
    [0.93, 0.22],
    [0.97, 0.0],
  ],
  cellDensity: [
    [0.0, 0.02],
    [0.12, 0.1],
    [0.8, 0.1],
    [0.9, 0.04],
    [1.0, 0.014],
  ],
  reverbWet: [
    [0.0, 0.26],
    [0.1, 0.22],
    [0.9, 0.22],
    [1.0, 0.36],
  ],
  lowPassHz: [
    [0.0, 1300],
    [0.08, 7000],
    [0.88, 7000],
    [1.0, 2400],
  ],
};

/**
 * Move — 筋トレ・運動中。Study/Work とは活動内容がまったく異なるため、
 * **構造そのものを別物にした**（ADR-009。旧設計は Study/Work と同じ「ゆっくりイーズイン→
 * サステイン→テーパー」の弧をテンポだけ変えて流用しており、ユーザーから「同じにしか聞こえない」
 * という指摘を受けた）。
 *
 * - 根拠: Endel "Activity" はケイデンス（歩数・運動のリズム）に同調する打楽器を主役にする。
 *   運動は「今すぐ動き出す」文脈のため、他テーマのような穏やかなイーズインをやめ、
 *   t=0 から拍(pulse)がすでに鳴っている状態で始める（t=0.02 でほぼフルゲイン）
 * - pulse 層はキック+スネア+ハイハットの実際のドラムパターン（`generateWorkoutGroove`）。
 *   128bpm（一般的なワークアウト楽曲のテンポ帯）に変更（旧120bpm）
 * - pad 層はサイドチェイン風に拍ごとダッキングする「ポンピング」エンベロープ
 *   （`generatePad` の `pumpBpm`）にし、和音の土台自体もリズムに同調させた
 * - reverb はほぼドライ（0.05–0.12）にして、Study/Work/Relax/Sleep の「空間に包まれる」
 *   方向性から明確に切り離した。cellDensity も高くして運動のエネルギー感を強めた
 */
export const moveAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.3],
    [0.02, 0.5],
    [0.85, 0.5],
    [0.95, 0.42],
    [1.0, 0.22],
  ],
  texture: [
    [0.0, 0.08],
    [0.05, 0.14],
    [0.85, 0.14],
    [1.0, 0.1],
  ],
  pulse: [
    [0.0, 0.35],
    [0.02, 0.72],
    [0.85, 0.72],
    [0.93, 0.42],
    [0.97, 0.15],
  ],
  cellDensity: [
    [0.0, 0.05],
    [0.06, 0.22],
    [0.8, 0.22],
    [0.9, 0.08],
    [1.0, 0.03],
  ],
  reverbWet: [
    [0.0, 0.06],
    [0.05, 0.05],
    [0.9, 0.05],
    [1.0, 0.12],
  ],
  lowPassHz: [
    [0.0, 6000],
    [0.05, 9800],
    [0.88, 9800],
    [1.0, 6500],
  ],
};

/**
 * Relax — 短い休憩。
 * 根拠: endel.io/relax — "don't include beats or complex sound textures — simple sound
 * structures that are easy for your brain to process"。docs/research/relax-sleep-sound-chatgpt.md
 * の「60–80BPM・柔らかく単純な旋律」を踏まえ、ADR-008 で追加した柔らかい旋律アルペジオ
 * （`generateArpeggioPulse`、拍ではなく歌のようなフレーズ）は維持しつつ「ある程度の音楽性」を
 * 保った。
 *
 * **ADR-009 で振れ幅を大きく縮小**: 旧設計は pad 0.47→0.77、reverbWet 0.45→0.65 と
 * 大きく動いており、Pad Ensemble のドリフト（当時 depth=0.45）と組み合わさって
 * 「リバーブが上下に呼吸するように膨らむ」不快感の原因になっていた（ユーザー報告）。
 * pad/texture/reverbWet の Sustain 区間の振れ幅をいずれも半分以下に抑え、
 * Endel の言う "simple... easy to process" に合わせて全体をほぼ静止させた。
 */
export const relaxAutomation: PhaseAutomation = {
  pad: [
    [0.0, 0.42],
    [0.15, 0.62],
    [0.85, 0.62],
    [1.0, 0.42],
  ],
  texture: [
    [0.0, 0.32],
    [0.15, 0.5],
    [0.85, 0.5],
    [1.0, 0.36],
  ],
  pulse: [
    [0.0, 0.0],
    [0.15, 0.0],
    [0.3, 0.22],
    [0.85, 0.22],
    [1.0, 0.12],
  ],
  cellDensity: [
    [0.0, 0.035],
    [0.2, 0.02],
    [0.85, 0.02],
    [1.0, 0.03],
  ],
  reverbWet: [
    [0.0, 0.32],
    [0.15, 0.4],
    [0.85, 0.4],
    [1.0, 0.34],
  ],
  lowPassHz: [
    [0.0, 2600],
    [0.15, 2000],
    [0.85, 2000],
    [1.0, 2800],
  ],
};

/**
 * Sleep — 深い休憩・入眠。ADR-008 のフェーズ構成（Onset→Deep）は維持。
 * ADR-009 では Relax と同じ理由（Pad Ensemble ドリフトとの相互作用）で pad/reverbWet の
 * ピーク値をやや下げ、より確実に「膨らみ過ぎない」ようにした。
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
    [0.0, 0.32],
    [0.05, 0.62],
    [0.35, 0.58],
    [0.42, 0.36],
    [0.65, 0.18],
    [1.0, 0.15],
  ],
  texture: [
    [0.0, 0.14],
    [0.05, 0.26],
    [0.35, 0.24],
    [0.42, 0.15],
    [0.65, 0.08],
    [1.0, 0.07],
  ],
  pulse: [
    [0.0, 0.0],
    [0.05, 0.0],
    [0.1, 0.24],
    [0.32, 0.24],
    [0.4, 0.0],
    [1.0, 0.0],
  ],
  cellDensity: [
    [0.0, 0.018],
    [0.05, 0.03],
    [0.35, 0.026],
    [0.42, 0.006],
    [1.0, 0.004],
  ],
  reverbWet: [
    [0.0, 0.42],
    [0.1, 0.56],
    [0.4, 0.6],
    [0.42, 0.66],
    [1.0, 0.7],
  ],
  lowPassHz: [
    [0.0, 1500],
    [0.1, 1150],
    [0.35, 1100],
    [0.42, 800],
    [1.0, 650],
  ],
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
