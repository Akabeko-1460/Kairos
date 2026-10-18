import type { SoundPack } from "@kairos/audio-engine";

/** Keep URL validation in sync with the policy at the top of public/sw.js. */
export function isPrecacheableUrl(
  value: string,
  origin: string = globalThis.location.origin,
): boolean {
  try {
    const path = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    if (path.includes("..") || path.includes("\\")) return false;
    const url = new URL(value, origin);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      (url.pathname.startsWith("/audio/") ||
        url.pathname.startsWith("/ir/") ||
        url.pathname === "/packs.json")
    );
  } catch {
    return false;
  }
}

export function collectPackAssetUrls(packs: readonly SoundPack[]): string[] {
  const urls = new Set<string>();
  for (const pack of packs) {
    for (const theme of Object.values(pack.themes)) {
      urls.add(theme.ir);
      for (const layer of theme.layers) {
        for (const url of layer.takes ?? []) urls.add(url);
        for (const url of layer.oneShots ?? []) urls.add(url);
      }
    }
    for (const url of Object.values(pack.cues)) urls.add(url);
  }
  return [...urls];
}
