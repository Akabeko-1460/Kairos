"use client";

import { useEffect } from "react";
import { parseSoundPacks } from "@kairos/audio-engine";
import { collectPackAssetUrls, isPrecacheableUrl } from "@/lib/offlineAssets";
import { useSoundscapeRuntime } from "@/lib/soundscapeRuntime";

type DataSavingNavigator = Navigator & { connection?: { saveData?: boolean } };

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    let scheduled = false;
    let cancelIdle = () => {};
    const registration = navigator.serviceWorker.register("/sw.js");
    // Registration may fail on unsupported origins or when storage is disabled.
    void registration.catch(() => {});

    async function precache() {
      if ((navigator as DataSavingNavigator).connection?.saveData) return;
      try {
        await registration;
        const ready = await navigator.serviceWorker.ready;
        const response = await fetch("/packs.json");
        if (!response.ok) return;
        const packs = parseSoundPacks(await response.json());
        const urls = ["/packs.json", ...collectPackAssetUrls(packs)].filter((url) =>
          isPrecacheableUrl(url),
        );
        if (!disposed && !(navigator as DataSavingNavigator).connection?.saveData) {
          ready.active?.postMessage({ type: "precache", urls });
        }
      } catch {
        // Playback remains available if background caching fails.
      }
    }

    function onPlayback() {
      const { debugInfo } = useSoundscapeRuntime.getState();
      if (scheduled || !debugInfo?.currentTheme || debugInfo.contextState !== "running") return;
      scheduled = true;
      if ((navigator as DataSavingNavigator).connection?.saveData) return;
      if (typeof window.requestIdleCallback === "function") {
        const handle = window.requestIdleCallback(() => void precache());
        cancelIdle = () => window.cancelIdleCallback(handle);
      } else {
        const handle = window.setTimeout(() => void precache(), 1000);
        cancelIdle = () => window.clearTimeout(handle);
      }
    }

    const unsubscribe = useSoundscapeRuntime.subscribe(onPlayback);
    onPlayback();
    return () => {
      disposed = true;
      unsubscribe();
      cancelIdle();
    };
  }, []);

  return null;
}
