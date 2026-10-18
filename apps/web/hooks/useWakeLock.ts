"use client";

import type { TimerState } from "@kairos/core";
import { useEffect } from "react";
import { shouldHoldWakeLock } from "@/lib/sessionIntegrations";

export function useWakeLock(state: TimerState, enabled: boolean) {
  const shouldHold = shouldHoldWakeLock(state, enabled, true);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.wakeLock || typeof document === "undefined") return;
    if (!shouldHold) return;

    let disposed = false;
    let sentinel: WakeLockSentinel | null = null;
    let requestVersion = 0;
    let pending = false;

    const release = async (lock: WakeLockSentinel) => {
      try {
        await lock.release();
      } catch (error) {
        console.warn("[Kairos] Wake lock release failed:", error);
      }
    };

    const releaseCurrent = () => {
      requestVersion += 1;
      pending = false;
      if (sentinel) void release(sentinel);
      sentinel = null;
    };

    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible" || pending || (sentinel && !sentinel.released)) return;
      const version = ++requestVersion;
      pending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        // An in-flight request can finish after hiding, pausing, or leaving this page.
        if (disposed || version !== requestVersion || document.visibilityState !== "visible") {
          await release(lock);
          return;
        }
        sentinel = lock;
      } catch (error) {
        console.warn("[Kairos] Wake lock request failed:", error);
      } finally {
        if (version === requestVersion) pending = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void acquire();
      else releaseCurrent();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseCurrent();
    };
  }, [shouldHold]);
}
