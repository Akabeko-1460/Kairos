import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isPulseLoopAligned } from "./pulse-loop";
import type { SoundPack, ThemeId } from "./types";
import { THEME_IDS } from "./types";

/**
 * docs/CLAUDE.md コーディング規約の実物検証:
 * - pulse 素材の loopSeconds × bpm / 60 が整数である
 * - ループ素材は 32秒以下（docs/04_SOUND_ENGINE.md §6.6 のメモリ制約）
 *
 * `apps/web/public/packs.json` を直接読む唯一のテスト。audio-engine パッケージは
 * apps/web の実装には依存しないが、apps/web が生成するデータの形は audio-engine の型で
 * 決まるため、ここで検証するのが自然（このファイル以外から apps/web を参照しないこと）。
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKS_JSON_PATH = path.resolve(__dirname, "../../../apps/web/public/packs.json");

function loadPacks(): SoundPack[] {
  const raw = readFileSync(PACKS_JSON_PATH, "utf-8");
  return (JSON.parse(raw) as { packs: SoundPack[] }).packs;
}

describe("apps/web/public/packs.json", () => {
  const packs = loadPacks();

  it("defines all 5 themes for every pack", () => {
    for (const pack of packs) {
      for (const themeId of THEME_IDS) {
        expect(pack.themes[themeId], `${pack.id} is missing theme "${themeId}"`).toBeDefined();
      }
    }
  });

  it("keeps every pulse layer's loopSeconds aligned to the theme's bpm", () => {
    for (const pack of packs) {
      for (const themeId of THEME_IDS) {
        const theme = pack.themes[themeId as ThemeId];
        const pulseLayer = theme.layers.find((l) => l.role === "pulse");
        if (!pulseLayer) continue;
        expect(theme.bpm, `${pack.id}/${themeId} has a pulse layer but no bpm`).not.toBeNull();
        expect(
          pulseLayer.loopSeconds,
          `${pack.id}/${themeId} pulse layer is missing loopSeconds`,
        ).toBeDefined();
        expect(
          isPulseLoopAligned(pulseLayer.loopSeconds!, theme.bpm!),
          `${pack.id}/${themeId} pulse loopSeconds (${pulseLayer.loopSeconds}) is not an integer number of beats at ${theme.bpm}bpm`,
        ).toBe(true);
      }
    }
  });

  it("keeps every loop layer under the 32s memory ceiling", () => {
    for (const pack of packs) {
      for (const themeId of THEME_IDS) {
        const theme = pack.themes[themeId as ThemeId];
        for (const layer of theme.layers) {
          if (layer.loopSeconds === undefined) continue;
          expect(
            layer.loopSeconds,
            `${pack.id}/${themeId}/${layer.role} loopSeconds exceeds the 32s ceiling`,
          ).toBeLessThanOrEqual(32);
        }
      }
    }
  });
});
