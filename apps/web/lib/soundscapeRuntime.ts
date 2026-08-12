"use client";

import {
  NEUTRAL_ENVIRONMENT,
  RECOMMENDED_TRANSITION_T,
  smoothEnvironment,
  SoundscapeEngine,
  targetEnvironmentModifier,
  timeOfDayFor,
  type EnvironmentModifier,
  type SoundPack,
  type ThemeId,
  type WeatherCategory,
} from "@kairos/audio-engine";
import {
  isPaused,
  isRunning,
  progress,
  skip as peekSkip,
  systemClock,
  type TimerState,
} from "@kairos/core";
import { create } from "zustand";
import { useTimerStore } from "@/hooks/useTimer";
import { fetchWeatherCategory } from "@/lib/environment";

const TICK_INTERVAL_MS = 100; // 10Hz。docs/03_ARCHITECTURE.md の useTimer -> SoundscapeEngine 結合点。
const CROSSFADE_SEC = 6;
/**
 * Home画面のフリー再生は特定のセッション長を持たないため、Sustain区間中央付近の t に固定して
 * 鳴らし続ける（docs/04_SOUND_ENGINE.md §4 の Ease-in/Sustain/Taper/Wind-down のうち Sustain のみを使う）。
 * Sleep だけは例外（下記 SLEEP_VIRTUAL_DURATION_SEC 参照）。
 */
const FREEPLAY_T = 0.45;

/**
 * docs/03_ARCHITECTURE.md ADR-008: Sleep のフリー再生（Home画面で夜通し流すことを想定）だけは
 * 経過時間で t を進める。「最初40分は入眠用、以降は深い睡眠を守るための静かな音」という
 * フェーズ設計を実時間で成立させるため、40分がテーマの t=0.4 に一致するよう
 * 100分（6000秒）を仮想セッション長とする。バックグラウンドタブでこのインターバルの発火間隔が
 * 間延びしても、実時刻の差分を積算するので進み方はずれない。
 */
const SLEEP_VIRTUAL_DURATION_SEC = 100 * 60;

/** Pomodoro の Break フェーズで鳴らすテーマは固定（ユーザー選択不可）。短い休憩は Relax、
 *  長い休憩はより深く鎮める Sleep にする — docs/04_SOUND_ENGINE.md ADR-004。 */
const SHORT_BREAK_THEME: ThemeId = "relax";
const LONG_BREAK_THEME: ThemeId = "sleep";

export type PlaybackMode = "idle" | "freeplay" | "timer";
export type EngineDebugInfo = ReturnType<SoundscapeEngine["getDebugInfo"]>;

/**
 * タイマーの現在フェーズと、ユーザーが選んだ Focus テーマから、鳴らすべきテーマを1つに決める
 * 純粋関数。Focus フェーズ中に focusThemeId が変わった場合もこの関数の戻り値が変わるので、
 * 呼び出し側は「前回と違う値になったらクロスフェード」という単純な比較だけで済む。
 */
function themeIdForTimerPhase(phase: TimerState["phase"], focusThemeId: ThemeId): ThemeId | null {
  if (phase === "focus") return focusThemeId;
  if (phase === "shortBreak") return SHORT_BREAK_THEME;
  if (phase === "longBreak") return LONG_BREAK_THEME;
  return null;
}

function logEngineError(err: unknown): void {
  console.error("[Kairos] SoundscapeEngine error:", err);
}

interface SoundscapeRuntimeStore {
  engineReady: boolean;
  debugInfo: EngineDebugInfo;
  mode: PlaybackMode;
  freeplayThemeId: ThemeId | null;
  freeplayPlaying: boolean;
  /** Pomodoro の Focus フェーズで鳴らす/描くサウンドテーマ。デフォルトは "Study"。 */
  focusThemeId: ThemeId;
  /**
   * マスター音量。Home/Pomodoro どちらの音量バーからも同じ値を読み書きする
   * （エンジンはページを跨いだシングルトンなので、音量もページ間で共有するのが自然）。
   */
  masterVolume: number;

  ensureEngine: () => Promise<SoundscapeEngine>;
  /** Pomodoro 画面が Start されたら呼ぶ。以後このループがタイマー駆動でエンジンを制御する。 */
  switchToTimerMode: () => void;
  setFocusThemeId: (id: ThemeId) => void;
  playFreeplay: (themeId: ThemeId) => Promise<void>;
  toggleFreeplayPause: () => void;
  regenerateFreeplay: () => void;
  stopFreeplay: () => void;
  setMasterVolume: (v: number) => void;
}

// このモジュールを跨いだ再インポートでも二重初期化しないよう、状態はモジュールスコープに持つ。
let engine: SoundscapeEngine | null = null;
let loopStarted = false;
let currentThemeIdRef: ThemeId | null = null;
let transitionArmed = false;
let wasPaused = false;
// Sleep のフリー再生専用の経過時間トラッカー（ADR-008）。playFreeplay("sleep") で 0 にリセットする。
let freeplaySleepElapsedSec = 0;
let freeplaySleepLastTickAtMs: number | null = null;

// --- 天気・時間帯・経過時間による環境モジュレーション（ADR-010） ---
const WEATHER_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30分ごとに再取得すれば十分（天気は数分単位では変わらない）
let currentWeather: WeatherCategory | null = null;
let weatherFetchedAtMs: number | null = null;
let weatherFetchInFlight = false;
/** 音を鳴らし始めてからの実時間の起点。Pomodoroのフェーズをまたいでも積算し続け、完全に停止したらリセットする。 */
let environmentSessionStartedAtMs: number | null = null;
let smoothedEnvironment: EnvironmentModifier = NEUTRAL_ENVIRONMENT;
let environmentLastTickAtMs: number | null = null;

function ensureWeatherFresh(): void {
  const now = Date.now();
  if (weatherFetchInFlight) return;
  if (weatherFetchedAtMs !== null && now - weatherFetchedAtMs < WEATHER_REFRESH_INTERVAL_MS) return;
  weatherFetchInFlight = true;
  weatherFetchedAtMs = now; // フェッチ中に再度呼ばれても二重発火しないよう先に更新しておく
  void fetchWeatherCategory()
    .then((category) => {
      currentWeather = category;
    })
    .finally(() => {
      weatherFetchInFlight = false;
    });
}

function ensureEnvironmentSessionStarted(): void {
  if (environmentSessionStartedAtMs === null) environmentSessionStartedAtMs = Date.now();
}

function resetEnvironmentSession(): void {
  environmentSessionStartedAtMs = null;
  smoothedEnvironment = NEUTRAL_ENVIRONMENT;
  environmentLastTickAtMs = null;
}

/**
 * 毎ティック呼ぶ。天気の鮮度確認、目標値の算出、なだらかな追従（smoothEnvironment）までを行う。
 * 「ゆっくりなだらかに切り替える」の実体はここ — 天気や時間帯が変わっても瞬時には動かない。
 */
function tickEnvironment(): EnvironmentModifier {
  ensureWeatherFresh();
  const now = Date.now();
  const dtSec = environmentLastTickAtMs === null ? 0 : (now - environmentLastTickAtMs) / 1000;
  environmentLastTickAtMs = now;

  const sessionElapsedSec =
    environmentSessionStartedAtMs === null ? 0 : (now - environmentSessionStartedAtMs) / 1000;
  const target = targetEnvironmentModifier({
    weather: currentWeather,
    timeOfDay: timeOfDayFor(new Date(now)),
    sessionElapsedSec,
  });
  smoothedEnvironment = smoothEnvironment(smoothedEnvironment, target, dtSec);
  return smoothedEnvironment;
}

export const useSoundscapeRuntime = create<SoundscapeRuntimeStore>((set, get) => {
  function startLoopOnce(): void {
    if (loopStarted) return;
    loopStarted = true;

    setInterval(() => {
      if (!engine) return;
      const mode = get().mode;

      if (mode === "timer") {
        useTimerStore.getState().syncToNow();
        const state = useTimerStore.getState().state;
        const now = systemClock.now();

        const paused = isPaused(state);
        if (paused !== wasPaused) {
          wasPaused = paused;
          if (paused) void engine.pause().catch(logEngineError);
          else void engine.resume().catch(logEngineError);
        }

        const themeId = themeIdForTimerPhase(state.phase, get().focusThemeId);
        if (!themeId) {
          if (currentThemeIdRef !== null) void engine.stop().catch(logEngineError);
          currentThemeIdRef = null;
          transitionArmed = false;
          resetEnvironmentSession();
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        // テーマが実際に切り替わった（フェーズ遷移・Skip・早期トリガーの取りこぼしからの復帰・
        // Focus 中の手動テーマ変更、すべてこの1箇所で処理する。ここを素通りさせるとBGMが
        // 切り替わらないバグになる）。
        if (themeId !== currentThemeIdRef) {
          const isFirstTheme = currentThemeIdRef === null;
          currentThemeIdRef = themeId;
          transitionArmed = false;
          if (isFirstTheme) {
            ensureEnvironmentSessionStarted();
            void engine.begin(themeId, state.sessionSeed).catch(logEngineError);
          } else {
            void engine.transitionTo(themeId, state.sessionSeed, CROSSFADE_SEC).catch(logEngineError);
          }
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        if (!isRunning(state)) {
          environmentLastTickAtMs = null; // 一時停止中はdtを積算せず、再開時に大きな飛びが出ないようにする
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        const t = progress(state, now);
        engine.tick(t, tickEnvironment());
        set({ debugInfo: engine.getDebugInfo() });

        if (!transitionArmed && t >= RECOMMENDED_TRANSITION_T) {
          transitionArmed = true;
          const peeked = peekSkip(state, now);
          const nextThemeId = themeIdForTimerPhase(peeked.phase, get().focusThemeId);
          if (nextThemeId) {
            void engine.transitionTo(nextThemeId, peeked.sessionSeed, CROSSFADE_SEC).catch(logEngineError);
            currentThemeIdRef = nextThemeId;
          }
        }
        return;
      }

      if (mode === "freeplay") {
        if (get().freeplayPlaying) {
          const environment = tickEnvironment();
          if (get().freeplayThemeId === "sleep") {
            // ADR-008: 実経過時間を積算して t を進める。バックグラウンドタブでこの
            // setInterval 自体の発火が間引かれても、Date.now() の差分を足すので
            // （固定の 0.1秒を毎回足すのと違い）実時間からズレない。
            const now = Date.now();
            if (freeplaySleepLastTickAtMs !== null) {
              freeplaySleepElapsedSec += (now - freeplaySleepLastTickAtMs) / 1000;
            }
            freeplaySleepLastTickAtMs = now;
            engine.tick(Math.min(1, freeplaySleepElapsedSec / SLEEP_VIRTUAL_DURATION_SEC), environment);
          } else {
            freeplaySleepLastTickAtMs = null;
            engine.tick(FREEPLAY_T, environment);
          }
        } else {
          freeplaySleepLastTickAtMs = null; // 一時停止中は経過時間を進めない
          environmentLastTickAtMs = null; // 一時停止中はdtを積算せず、再開時に大きな飛びが出ないようにする
        }
        set({ debugInfo: engine.getDebugInfo() });
        return;
      }

      set({ debugInfo: engine.getDebugInfo() });
    }, TICK_INTERVAL_MS);
  }

  return {
    engineReady: false,
    debugInfo: null,
    mode: "idle",
    freeplayThemeId: null,
    freeplayPlaying: false,
    focusThemeId: "study",
    masterVolume: 0.8,

    ensureEngine: async () => {
      if (engine) return engine;
      const created = new SoundscapeEngine();
      await created.init();
      const res = await fetch("/packs.json");
      const { packs } = (await res.json()) as { packs: SoundPack[] };
      const pack = packs[0];
      if (!pack) throw new Error("packs.json に SoundPack が1つも定義されていません。");
      await created.loadPack(pack);
      // Start前・Pomodoro開始前に音量バーが操作されている場合があるので、
      // エンジン生成のタイミングでその時点のマスター音量を適用する。
      created.setMasterVolume(get().masterVolume);
      engine = created;
      set({ engineReady: true });
      startLoopOnce();
      return created;
    },

    switchToTimerMode: () => set({ mode: "timer" }),

    setFocusThemeId: (id) => set({ focusThemeId: id }),

    playFreeplay: async (themeId) => {
      const e = await get().ensureEngine();
      set({ mode: "freeplay", freeplayThemeId: themeId, freeplayPlaying: true });
      // 新しく再生を始めるたびに「入眠しなおす」ものとして経過時間をリセットする
      // （テーマの切り替えでも、Sleep をもう一度選び直した場合でも同様）。
      freeplaySleepElapsedSec = 0;
      freeplaySleepLastTickAtMs = null;
      // ADR-010: こちらは「音を鳴らし始めてからの経過時間」軸のセッション開始。テーマの
      // 切り替え（Study→Work等）では継続して積算したいので、既に始まっていればリセットしない。
      ensureEnvironmentSessionStarted();
      try {
        // begin() は currentGraph が既にあれば自動でクロスフェードに切り替える。
        await e.begin(themeId, Date.now());
        currentThemeIdRef = themeId;
      } catch (err) {
        logEngineError(err);
      }
    },

    toggleFreeplayPause: () => {
      const e = engine;
      if (!e) return;
      const playing = get().freeplayPlaying;
      set({ freeplayPlaying: !playing });
      if (playing) void e.pause().catch(logEngineError);
      else void e.resume().catch(logEngineError);
    },

    regenerateFreeplay: () => {
      const e = engine;
      const themeId = get().freeplayThemeId;
      if (!e || !themeId) return;
      void e
        .transitionTo(themeId, Date.now(), CROSSFADE_SEC)
        .then(() => {
          currentThemeIdRef = themeId;
        })
        .catch(logEngineError);
    },

    stopFreeplay: () => {
      const e = engine;
      if (!e) return;
      set({ mode: "idle", freeplayThemeId: null, freeplayPlaying: false });
      void e.stop().catch(logEngineError);
      currentThemeIdRef = null;
      freeplaySleepElapsedSec = 0;
      freeplaySleepLastTickAtMs = null;
      resetEnvironmentSession();
    },

    setMasterVolume: (v) => {
      set({ masterVolume: v });
      engine?.setMasterVolume(v);
    },
  };
});

/**
 * ビジュアライザ用。AnalyserNode の生データを直接取得する。
 * 60fpsで読み出す想定なので、React state/zustand を経由させず直接エンジンから取る。
 */
export function getVisualizerFrequencyData(out: Uint8Array<ArrayBuffer>): boolean {
  if (!engine) return false;
  engine.getFrequencyData(out);
  return true;
}
