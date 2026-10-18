"use client";

import { useEffect } from "react";
import { mediaActionFor, mediaSessionSnapshot } from "@/lib/sessionIntegrations";
import { useTimerStore } from "./useTimer";

const MEDIA_ACTIONS = ["play", "pause", "nexttrack"] as const;

export function useMediaSession() {
  const state = useTimerStore((store) => store.state);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaSession) return;
    const session = navigator.mediaSession;
    const snapshot = mediaSessionSnapshot(state);
    if (typeof MediaMetadata !== "undefined") session.metadata = new MediaMetadata(snapshot.metadata);
    session.playbackState = snapshot.playbackState;

    const registered: MediaSessionAction[] = [];
    for (const action of MEDIA_ACTIONS) {
      try {
        session.setActionHandler(action, () => {
          // Read the latest state even when several media events arrive before React renders.
          const store = useTimerStore.getState();
          const command = mediaActionFor(action, store.state);
          if (command) store[command]();
        });
        registered.push(action);
      } catch (error) {
        console.warn("[Kairos] Media action unavailable:", action, error);
      }
    }

    return () => {
      for (const action of registered) session.setActionHandler(action, null);
      session.metadata = null;
      session.playbackState = "none";
    };
  }, [state]);
}
