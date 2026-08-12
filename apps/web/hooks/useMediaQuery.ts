"use client";

import { useSyncExternalStore } from "react";

function subscribe(query: string, onChange: () => void): () => void {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * 指定した media query に現在マッチしているかを返す。`useSyncExternalStore` は
 * SSR用のスナップショット（getServerSnapshot、window を一切参照しない安全な既定値）と
 * クライアント用のスナップショット（getSnapshot、実際の window.matchMedia）を
 * 出し分けられるため、effect 経由の setState（react-hooks/set-state-in-effect が禁止する
 * パターン）を使わずに済む。
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
