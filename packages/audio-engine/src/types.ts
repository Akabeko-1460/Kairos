/**
 * docs/04_SOUND_ENGINE.md §5 の主要インターフェース。
 * このパッケージは React に依存しない。Web Audio API のみに依存する（docs/CLAUDE.md コーディング規約）。
 */
export type LayerRole = "pad" | "texture" | "pulse" | "cell" | "cue";

/** タイマー側の SessionPhase から 'idle' | 'completed' を除いたもの。エンジンは常に音の鳴る3フェーズだけを扱う。 */
export type EnginePhase = "focus" | "shortBreak" | "longBreak";

/** サウンドパック上は shortBreak/longBreak を区別しない（同じ "break" 定義を使う）。 */
export type SoundDefinitionKey = "focus" | "break";

export function soundDefinitionKeyFor(phase: EnginePhase): SoundDefinitionKey {
  return phase === "focus" ? "focus" : "break";
}

/** キーフレーム列。t は 0.0–1.0 の昇順。線形補間。 */
export type Keyframes = ReadonlyArray<readonly [t: number, value: number]>;

export interface PhaseAutomation {
  readonly pad: Keyframes;
  readonly texture: Keyframes;
  readonly pulse: Keyframes;
  readonly cellDensity: Keyframes; // 毎秒の期待発火数
  readonly reverbWet: Keyframes;
  readonly lowPassHz: Keyframes;
  readonly breathLfoHz: number;
  readonly breathDepth: number;
}

export interface LayerSpec {
  readonly role: LayerRole;
  readonly loopSeconds?: number;
  readonly mono?: boolean;
  readonly takes?: readonly string[];
  readonly oneShots?: readonly string[];
}

export interface PhaseSoundDefinition {
  readonly key: string; // 'A' など
  readonly scale: string; // SCALES のキー
  readonly bpm: number | null;
  readonly layers: readonly LayerSpec[];
}

export interface SoundPack {
  readonly id: string;
  readonly name: string;
  readonly tuning: number; // Hz. Endel と同じ 440 を既定にする
  readonly ir: { readonly focus: string; readonly break: string };
  readonly focus: PhaseSoundDefinition;
  readonly break: PhaseSoundDefinition;
  readonly cues: { readonly phaseEnd: string; readonly sessionEnd: string };
}
