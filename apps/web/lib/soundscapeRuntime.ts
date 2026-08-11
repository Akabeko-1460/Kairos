"use client";

import {
  RECOMMENDED_TRANSITION_T,
  SoundscapeEngine,
  type EnginePhase,
  type SoundPack,
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

const TICK_INTERVAL_MS = 100; // 10Hz。docs/03_ARCHITECTURE.md の useTimer -> SoundscapeEngine 結合点。
const CROSSFADE_SEC = 6;
/**
 * Home画面のフリー再生は特定のセッション長を持たないため、Sustain区間中央付近の t に固定して
 * 鳴らし続ける（docs/04_SOUND_ENGINE.md §4 の Ease-in/Sustain/Taper/Wind-down のうち Sustain のみを使う）。
 */
const FREEPLAY_T = 0.45;

export type PlaybackMode = "idle" | "freeplay" | "timer";
export type EngineDebugInfo = ReturnType<SoundscapeEngine["getDebugInfo"]>;

function toEnginePhase(phase: TimerState["phase"]): EnginePhase | null {
  if (phase === "focus" || phase === "shortBreak" || phase === "longBreak") return phase;
  return null;
}

function logEngineError(err: unknown): void {
  console.error("[Kairos] SoundscapeEngine error:", err);
}

interface SoundscapeRuntimeStore {
  engineReady: boolean;
  debugInfo: EngineDebugInfo;
  mode: PlaybackMode;
  freeplayPhase: EnginePhase | null;
  freeplayPlaying: boolean;

  ensureEngine: () => Promise<SoundscapeEngine>;
  /** Pomodoro 画面が Start されたら呼ぶ。以後このループがタイマー駆動でエンジンを制御する。 */
  switchToTimerMode: () => void;
  playFreeplay: (phase: EnginePhase) => Promise<void>;
  toggleFreeplayPause: () => void;
  regenerateFreeplay: () => void;
  stopFreeplay: () => void;
  setMasterVolume: (v: number) => void;
}

// このモジュールを跨いだ再インポートでも二重初期化しないよう、状態はモジュールスコープに持つ。
let engine: SoundscapeEngine | null = null;
let loopStarted = false;
let enginePhaseRef: EnginePhase | null = null;
let transitionArmed = false;
let wasPaused = false;

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

        const enginePhase = toEnginePhase(state.phase);
        if (!enginePhase) {
          if (enginePhaseRef !== null) void engine.stop().catch(logEngineError);
          enginePhaseRef = null;
          transitionArmed = false;
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        // フェーズが実際に切り替わった（初回開始・Skip・早期トリガーの取りこぼしからの復帰、
        // すべてこの1箇所で処理する。ここを素通りさせるとBGMが切り替わらないバグになる）。
        if (enginePhase !== enginePhaseRef) {
          const isFirstPhase = enginePhaseRef === null;
          enginePhaseRef = enginePhase;
          transitionArmed = false;
          if (isFirstPhase) void engine.begin(enginePhase, state.sessionSeed).catch(logEngineError);
          else void engine.transitionTo(enginePhase, state.sessionSeed, CROSSFADE_SEC).catch(logEngineError);
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        if (!isRunning(state)) {
          set({ debugInfo: engine.getDebugInfo() });
          return;
        }

        const t = progress(state, now);
        engine.tick(t);
        set({ debugInfo: engine.getDebugInfo() });

        if (!transitionArmed && t >= RECOMMENDED_TRANSITION_T) {
          transitionArmed = true;
          const peeked = peekSkip(state, now);
          const nextEnginePhase = toEnginePhase(peeked.phase);
          if (nextEnginePhase) {
            void engine.transitionTo(nextEnginePhase, peeked.sessionSeed, CROSSFADE_SEC).catch(logEngineError);
            enginePhaseRef = nextEnginePhase;
          }
        }
        return;
      }

      if (mode === "freeplay") {
        if (get().freeplayPlaying) engine.tick(FREEPLAY_T);
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
    freeplayPhase: null,
    freeplayPlaying: false,

    ensureEngine: async () => {
      if (engine) return engine;
      const created = new SoundscapeEngine();
      await created.init();
      const res = await fetch("/packs.json");
      const { packs } = (await res.json()) as { packs: SoundPack[] };
      const pack = packs[0];
      if (!pack) throw new Error("packs.json に SoundPack が1つも定義されていません。");
      await created.loadPack(pack);
      engine = created;
      set({ engineReady: true });
      startLoopOnce();
      return created;
    },

    switchToTimerMode: () => set({ mode: "timer" }),

    playFreeplay: async (phase) => {
      const e = await get().ensureEngine();
      set({ mode: "freeplay", freeplayPhase: phase, freeplayPlaying: true });
      try {
        // begin() は currentGraph が既にあれば自動でクロスフェードに切り替える。
        await e.begin(phase, Date.now());
        enginePhaseRef = phase;
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
      const phase = get().freeplayPhase;
      if (!e || !phase) return;
      void e
        .transitionTo(phase, Date.now(), CROSSFADE_SEC)
        .then(() => {
          enginePhaseRef = phase;
        })
        .catch(logEngineError);
    },

    stopFreeplay: () => {
      const e = engine;
      if (!e) return;
      set({ mode: "idle", freeplayPhase: null, freeplayPlaying: false });
      void e.stop().catch(logEngineError);
      enginePhaseRef = null;
    },

    setMasterVolume: (v) => {
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
