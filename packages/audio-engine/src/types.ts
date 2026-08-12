/**
 * docs/04_SOUND_ENGINE.md §5 の主要インターフェース。
 * このパッケージは React に依存しない。Web Audio API のみに依存する（docs/CLAUDE.md コーディング規約）。
 */
export type LayerRole = "pad" | "texture" | "pulse" | "cell" | "cue";

/**
 * UIの5テーマ（Study/Work/Move/Relax/Sleep）と1:1で対応するサウンドの識別子。
 * rev.2 までは "focus"/"break" の2種類の音響エンジンしか無く、テーマは見た目だけの差分だった。
 * rev.3 でテーマそのものを音響定義の単位にし、`docs/deep-research-report_chatGPT.md` /
 * `docs/集中力を高める音の文献調査_gemini.md` の知見をテーマごとに反映できるようにした。
 */
export type ThemeId = "study" | "work" | "move" | "relax" | "sleep";

export const THEME_IDS: readonly ThemeId[] = ["study", "work", "move", "relax", "sleep"];

/**
 * テーマがタイマーのどちらのフェーズに属するか。
 * focus 系テーマ（study/work/move）は Focus フェーズで、break 系テーマ（relax/sleep）は
 * Break フェーズ（shortBreak/longBreak）でのみ使う。クロスフェード可否の判定には使わない
 * （テーマ間の切り替えは常にクロスフェードする）。
 */
export type ThemeKind = "focus" | "break";

/** キーフレーム列。t は 0.0–1.0 の昇順。線形補間。 */
export type Keyframes = ReadonlyArray<readonly [t: number, value: number]>;

export interface PhaseAutomation {
  readonly pad: Keyframes;
  readonly texture: Keyframes;
  readonly pulse: Keyframes;
  readonly cellDensity: Keyframes; // 毎秒の期待発火数
  readonly reverbWet: Keyframes;
  readonly lowPassHz: Keyframes;
}

export interface LayerSpec {
  readonly role: LayerRole;
  readonly loopSeconds?: number;
  readonly mono?: boolean;
  readonly takes?: readonly string[];
  readonly oneShots?: readonly string[];
}

/** 1テーマ分の音響定義。全レイヤーは同一の key/scale に揃え、何を鳴らしても不協和にならないようにする。 */
export interface ThemeSoundDefinition {
  readonly kind: ThemeKind;
  readonly key: string; // 'A' など
  readonly scale: string; // SCALES のキー
  readonly bpm: number | null; // pulse 層を持たないテーマ（relax/sleep）は null
  readonly ir: string; // このテーマ専用のインパルス応答
  readonly layers: readonly LayerSpec[];
  readonly automation: PhaseAutomation;
}

export interface SoundPack {
  readonly id: string;
  readonly name: string;
  readonly tuning: number; // Hz. Endel と同じ 440 を既定にする
  readonly themes: Readonly<Record<ThemeId, ThemeSoundDefinition>>;
  readonly cues: { readonly phaseEnd: string; readonly sessionEnd: string };
}
