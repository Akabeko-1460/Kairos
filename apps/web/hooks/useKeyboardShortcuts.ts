"use client";

import { useEffect, useRef } from "react";
import { shortcutAction, type ShortcutStatus } from "@/lib/keyboardShortcuts";
import { useSettingsStore } from "@/lib/settingsStore";
import { useTimerStore } from "./useTimer";

export function useKeyboardShortcuts(handleStart: () => Promise<void>) {
  const starting = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!useSettingsStore.getState().keyboardShortcutsEnabled) return;

      const store = useTimerStore.getState();
      const { phase, pausedAt } = store.state;
      let status: ShortcutStatus = "running";
      if (phase === "idle" || phase === "completed") status = "idle";
      else if (pausedAt !== null) status = "paused";

      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = shortcutAction({
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        targetTag: target?.tagName ?? "",
        isContentEditable: target?.isContentEditable ?? false,
      }, status);
      if (!action) return;
      if (action !== "skip") event.preventDefault();

      if (action === "start") {
        if (starting.current) return;
        starting.current = true;
        // Invoke synchronously so AudioContext creation keeps the user gesture.
        void handleStart().finally(() => { starting.current = false; });
      } else {
        store[action]();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleStart]);
}
