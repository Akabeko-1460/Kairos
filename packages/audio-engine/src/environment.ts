/**
 * docs/03_ARCHITECTURE.md ADR-010: 天気・時間帯・経過時間という3つの「状況」から、
 * 各テーマの `PhaseAutomation` に上乗せする控えめな補正値（`EnvironmentModifier`）を
 * 計算する純粋関数群。副作用ゼロ（`packages/audio-engine` は React にも DOM にも依存しない、
 * `docs/CLAUDE.md` の規約）。天気の取得（Geolocation + 天気API）や時刻の取得（`new Date()`）は
 * `apps/web` 側の責務で、ここには一切持ち込まない。
 *
 * **設計原則（重要）**: 「気分に合わせる」とは気分に**似た**音を流すことではなく、
 * そのテーマが導きたい心理状態（Study なら静かな没入、Move なら運動への高揚、等）を
 * 壊さない範囲で彩りを加えることを指す。そのため各軸の効果はいずれも小さく（目安 ±20%以内）
 * 設計し、`clampModifier` で最終的な合成値にも安全域を設けている。
 */

export type WeatherCategory = "clear" | "cloudy" | "rain" | "snow";
export type TimeOfDay = "morning" | "noon" | "evening";

export interface EnvironmentContext {
  /** 取得できない/まだ取得していない場合は null（cloudy と同じ中立値として扱う）。 */
  readonly weather: WeatherCategory | null;
  readonly timeOfDay: TimeOfDay;
  /** 音を鳴らし始めてからの実経過秒数。Pomodoro のフェーズをまたいで積算する。 */
  readonly sessionElapsedSec: number;
}

/**
 * `PhaseAutomation` の出力に掛け合わせる/加算する補正値。
 * gain 系は乗算（1.0 = 無補正）、`reverbWetDelta` は加算、`rainOverlayGain` は
 * 全テーマ共通で使う雨のオーバーレイ層（既存の `audio/relax/texture_rain.wav` を再利用）の
 * 目標ゲイン（0 = 無音）。
 */
export interface EnvironmentModifier {
  readonly padGain: number;
  readonly textureGain: number;
  readonly pulseGain: number;
  readonly cellDensityFactor: number;
  readonly reverbWetDelta: number;
  readonly lowPassFactor: number;
  readonly rainOverlayGain: number;
}

export const NEUTRAL_ENVIRONMENT: EnvironmentModifier = {
  padGain: 1,
  textureGain: 1,
  pulseGain: 1,
  cellDensityFactor: 1,
  reverbWetDelta: 0,
  lowPassFactor: 1,
  rainOverlayGain: 0,
};

function combine(a: EnvironmentModifier, b: EnvironmentModifier): EnvironmentModifier {
  return {
    padGain: a.padGain * b.padGain,
    textureGain: a.textureGain * b.textureGain,
    pulseGain: a.pulseGain * b.pulseGain,
    cellDensityFactor: a.cellDensityFactor * b.cellDensityFactor,
    reverbWetDelta: a.reverbWetDelta + b.reverbWetDelta,
    lowPassFactor: a.lowPassFactor * b.lowPassFactor,
    rainOverlayGain: Math.max(a.rainOverlayGain, b.rainOverlayGain),
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/** 3軸を合成しても、どのテーマの核となる性格も壊さないための安全域。 */
function clampModifier(m: EnvironmentModifier): EnvironmentModifier {
  return {
    padGain: clamp(m.padGain, 0.85, 1.15),
    textureGain: clamp(m.textureGain, 0.85, 1.15),
    pulseGain: clamp(m.pulseGain, 0.75, 1.15),
    cellDensityFactor: clamp(m.cellDensityFactor, 0.7, 1.2),
    reverbWetDelta: clamp(m.reverbWetDelta, -0.05, 0.08),
    lowPassFactor: clamp(m.lowPassFactor, 0.65, 1.25),
    rainOverlayGain: clamp(m.rainOverlayGain, 0, 0.2),
  };
}

// --- 天気 ---

/**
 * WMO Weather interpretation codes（Open-Meteo が採用する標準コード、
 * https://open-meteo.com/en/docs 参照）を4カテゴリへ単純化する。
 * 「音は作る前に条件に合うものを探し、なるべく既存のセットを用いる」方針のため、
 * カテゴリは既存アセットで表現できる範囲に絞った（新規音源はゼロ）:
 * - rain: 既存の `audio/relax/texture_rain.wav` を全テーマ共通でうっすら重ねる
 * - snow: 雪は音を物理的に吸収する（積雪の遮音効果）ため、新規音源ではなく
 *   lowPassFactor を大きく下げることで「こもった静かな世界」を表現する
 * - clear/cloudy: 既存パラメータの明るさ（lowPassFactor）だけで表現する
 */
export function weatherCategoryFromWmoCode(code: number): WeatherCategory {
  if (code === 0 || code === 1) return "clear";
  if (code === 2 || code === 3 || (code >= 45 && code <= 48)) return "cloudy";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  // 51-67(霧雨/雨), 80-82(にわか雨), 95-99(雷雨) はまとめて rain 扱いにする。
  return "rain";
}

const WEATHER_MODIFIER: Readonly<Record<WeatherCategory, EnvironmentModifier>> = {
  clear: { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 1.06 },
  cloudy: NEUTRAL_ENVIRONMENT,
  rain: { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 0.94, reverbWetDelta: 0.02, rainOverlayGain: 0.14 },
  snow: { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 0.85, cellDensityFactor: 0.9, reverbWetDelta: 0.015 },
};

// --- 時間帯（朝 / 昼 / 晩） ---

const MORNING_START_HOUR = 5;
const NOON_START_HOUR = 11;
const EVENING_START_HOUR = 17;

/** ローカル時刻から朝/昼/晩を判定する純粋関数。`Date.now()` を直接呼ばず、Date を注入する。 */
export function timeOfDayFor(date: Date): TimeOfDay {
  const hour = date.getHours();
  if (hour >= MORNING_START_HOUR && hour < NOON_START_HOUR) return "morning";
  if (hour >= NOON_START_HOUR && hour < EVENING_START_HOUR) return "noon";
  return "evening";
}

const TIME_OF_DAY_MODIFIER: Readonly<Record<TimeOfDay, EnvironmentModifier>> = {
  // 朝: やや明るく・目覚めた質感に（lowPassを開ける程度の控えめな変化）
  morning: { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 1.12, padGain: 1.03 },
  // 昼: 各テーマがすでにチューニングされている基準値そのもの（無補正）
  noon: NEUTRAL_ENVIRONMENT,
  // 晩: やや暗く・リバーブを少し足して落ち着いた質感に
  evening: { ...NEUTRAL_ENVIRONMENT, lowPassFactor: 0.9, reverbWetDelta: 0.03, padGain: 1.02 },
};

// --- 経過時間（音を鳴らし始めてからの実時間。聴取疲労を避けるゆるやかな減衰） ---

const FATIGUE_START_SEC = 45 * 60; // 45分を過ぎたら緩やかに刺激を絞り始める
const FATIGUE_FULL_SEC = 3 * 60 * 60; // 3時間で下限に達し、以降は一定
const FATIGUE_FLOOR = 0.82; // pulse/cellDensity の下限倍率（-18%）

/**
 * 長時間つけっぱなしにした際の聴取疲労を避けるための、ごく緩やかな刺激の減衰。
 * 「継続的な刺激への曝露は過剰になりうる」という知見（`環境による適切な音の変化.md` の
 * 確率共鳴・処理流暢性の議論、および ADR-008 の Sleep 設計と同じ方向性）を、
 * Study/Work/Move のような Focus 系テーマにも控えめに適用する。
 */
function elapsedModifier(sessionElapsedSec: number): EnvironmentModifier {
  const span = FATIGUE_FULL_SEC - FATIGUE_START_SEC;
  const ratio = clamp((sessionElapsedSec - FATIGUE_START_SEC) / span, 0, 1);
  const factor = 1 - (1 - FATIGUE_FLOOR) * ratio;
  return {
    ...NEUTRAL_ENVIRONMENT,
    pulseGain: factor,
    cellDensityFactor: factor,
    reverbWetDelta: 0.02 * ratio,
  };
}

/**
 * 天気・時間帯・経過時間の3軸から目標の `EnvironmentModifier` を合成する純粋関数。
 * `PhaseGraph.tick()` に渡す前提で、呼び出し側は `smoothEnvironment` でなだらかに近づけること
 * （このミュ関数自体は瞬間値=目標値であり、切り替えの滑らかさは持たない）。
 */
export function targetEnvironmentModifier(ctx: EnvironmentContext): EnvironmentModifier {
  const weather = ctx.weather ?? "cloudy";
  const combined = combine(
    combine(TIME_OF_DAY_MODIFIER[ctx.timeOfDay], WEATHER_MODIFIER[weather]),
    elapsedModifier(ctx.sessionElapsedSec),
  );
  return clampModifier(combined);
}

/**
 * 現在値から目標値へ指数的に近づける（「ゆっくりなだらかに切り替える」の実装本体）。
 * `tauSec` が大きいほど変化がゆっくりになる（63%到達までの目安時間）。呼び出し側は
 * 1ティックごとの経過秒数 `dtSec` を渡す（`packages/core` と同様、時刻は呼び出し側が注入する）。
 */
export function smoothEnvironment(
  current: EnvironmentModifier,
  target: EnvironmentModifier,
  dtSec: number,
  tauSec = 90,
): EnvironmentModifier {
  if (dtSec <= 0) return current;
  const alpha = 1 - Math.exp(-dtSec / tauSec);
  const lerp = (a: number, b: number): number => a + (b - a) * alpha;
  return {
    padGain: lerp(current.padGain, target.padGain),
    textureGain: lerp(current.textureGain, target.textureGain),
    pulseGain: lerp(current.pulseGain, target.pulseGain),
    cellDensityFactor: lerp(current.cellDensityFactor, target.cellDensityFactor),
    reverbWetDelta: lerp(current.reverbWetDelta, target.reverbWetDelta),
    lowPassFactor: lerp(current.lowPassFactor, target.lowPassFactor),
    rainOverlayGain: lerp(current.rainOverlayGain, target.rainOverlayGain),
  };
}

// PhaseGraph.tick() が pad/texture/pulse の3層すべてに同じ形の補正を適用するための対応表。
export const ENVIRONMENT_GAIN_FIELD: Readonly<Record<"pad" | "texture" | "pulse", keyof EnvironmentModifier>> = {
  pad: "padGain",
  texture: "textureGain",
  pulse: "pulseGain",
};
