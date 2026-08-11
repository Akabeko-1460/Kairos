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
import { useCallback, useEffect, useRef, useState } from "react";
import { useTimerStore } from "./useTimer";

const TICK_INTERVAL_MS = 100; // 10Hz。docs/03_ARCHITECTURE.md の useTimer -> SoundscapeEngine 結合点。
const CROSSFADE_SEC = 6;

function toEnginePhase(phase: TimerState["phase"]): EnginePhase | null {
  if (phase === "focus" || phase === "shortBreak" || phase === "longBreak") return phase;
  return null;
}

export type EngineDebugInfo = ReturnType<SoundscapeEngine["getDebugInfo"]>;

/**
 * タイマーの状態を SoundscapeEngine に橋渡しする。
 * `init()`/`begin()` はユーザー操作（Startボタン）を起点にのみ呼ぶこと（自動再生ポリシー対策、ADR-003）。
 */
export function useSoundscape() {
  const engineRef = useRef<SoundscapeEngine | null>(null);
  const enginePhaseRef = useRef<EnginePhase | null>(null);
  const transitionArmedRef = useRef(false);
  const wasPausedRef = useRef(false);
  const [engineReady, setEngineReady] = useState(false);
  const [debugInfo, setDebugInfo] = useState<EngineDebugInfo>(null);

  const syncToNow = useTimerStore((s) => s.syncToNow);

  const ensureEngine = useCallback(async (): Promise<SoundscapeEngine> => {
    if (engineRef.current) return engineRef.current;
    const engine = new SoundscapeEngine();
    await engine.init();
    const res = await fetch("/packs.json");
    const { packs } = (await res.json()) as { packs: SoundPack[] };
    const pack = packs[0];
    if (!pack) throw new Error("packs.json に SoundPack が1つも定義されていません。");
    await engine.loadPack(pack);
    engineRef.current = engine;
    setEngineReady(true);
    return engine;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const engine = engineRef.current;
      const state = useTimerStore.getState().state;
      const now = systemClock.now();

      // フェーズ超過があれば同期する（通常は下の早期トリガーが先に動くための保険）。
      syncToNow();

      if (!engine) return;

      const paused = isPaused(state);
      if (paused !== wasPausedRef.current) {
        wasPausedRef.current = paused;
        if (paused) void engine.pause();
        else void engine.resume();
      }

      const enginePhase = toEnginePhase(state.phase);
      if (!enginePhase) {
        if (enginePhaseRef.current !== null) void engine.stop();
        enginePhaseRef.current = null;
        transitionArmedRef.current = false;
        setDebugInfo(engine.getDebugInfo());
        return;
      }

      if (enginePhaseRef.current === null) {
        enginePhaseRef.current = enginePhase;
        transitionArmedRef.current = false;
        void engine.begin(enginePhase, state.sessionSeed);
        setDebugInfo(engine.getDebugInfo());
        return;
      }

      if (!isRunning(state)) {
        setDebugInfo(engine.getDebugInfo());
        return;
      }

      const t = progress(state, now);
      engine.tick(t);
      setDebugInfo(engine.getDebugInfo());

      if (enginePhase !== enginePhaseRef.current) {
        // 早期トリガーを取りこぼした場合の保険（例: タブ復帰直後で t が一気に進んでいた等）
        enginePhaseRef.current = enginePhase;
        transitionArmedRef.current = false;
      }

      if (!transitionArmedRef.current && t >= RECOMMENDED_TRANSITION_T) {
        transitionArmedRef.current = true;
        // タイマーの切替より音を先に動かす（docs/04_SOUND_ENGINE.md §6.4）。
        // 実際の state はまだ書き換えず、次に何になるかだけを読む。
        const peeked = peekSkip(state, now);
        const nextEnginePhase = toEnginePhase(peeked.phase);
        if (nextEnginePhase) {
          void engine.transitionTo(nextEnginePhase, peeked.sessionSeed, CROSSFADE_SEC);
          enginePhaseRef.current = nextEnginePhase;
        }
      }
    }, TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [syncToNow]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") syncToNow();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [syncToNow]);

  return { ensureEngine, engineReady, debugInfo };
}
