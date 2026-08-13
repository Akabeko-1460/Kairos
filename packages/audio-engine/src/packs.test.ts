import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { valueAt } from "./automation";
import { isPulseLoopAligned } from "./pulse-loop";
import { SCALES } from "./scales";
import type { Keyframes, PhaseAutomation, SoundPack, ThemeId } from "./types";
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

  it("names a scale that actually exists for every theme", () => {
    for (const pack of packs) {
      for (const themeId of THEME_IDS) {
        const theme = pack.themes[themeId as ThemeId];
        expect(
          Object.keys(SCALES),
          `${pack.id}/${themeId} uses an unknown scale "${theme.scale}"`,
        ).toContain(theme.scale);
      }
    }
  });
});

/**
 * オートメーション曲線そのものの健全性検証。
 *
 * 以前は `automation.ts` に同じ値のミラーがあり、単体テストはそちらだけを見ていたため、
 * **実際に出荷される packs.json の値は一切検証されていなかった**（実際 relax は乖離していた）。
 * ミラーを廃止し、ここで出荷データを直接検証する。
 */
describe("packs.json automation curves", () => {
  const packs = loadPacks();
  const AUTOMATION_KEYS = ["pad", "texture", "pulse", "cellDensity", "reverbWet", "lowPassHz"] as const;
  /** ゲイン系（0..1 に収まるべきもの）。cellDensity は毎秒発火数、lowPassHz は周波数なので別扱い。 */
  const GAIN_KEYS = ["pad", "texture", "pulse", "reverbWet"] as const;

  function eachCurve(visit: (label: string, key: (typeof AUTOMATION_KEYS)[number], curve: Keyframes) => void): void {
    for (const pack of packs) {
      for (const themeId of THEME_IDS) {
        const automation = pack.themes[themeId as ThemeId].automation as PhaseAutomation;
        for (const key of AUTOMATION_KEYS) {
          visit(`${pack.id}/${themeId}/${key}`, key, automation[key]);
        }
      }
    }
  }

  it("defines every automation curve with at least two keyframes", () => {
    eachCurve((label, _key, curve) => {
      expect(curve, `${label} is missing`).toBeDefined();
      expect(curve.length, `${label} needs at least 2 keyframes`).toBeGreaterThanOrEqual(2);
    });
  });

  it("keeps keyframe times ascending and inside 0..1", () => {
    // valueAt() は t が昇順であることを前提に線形補間する。順序が崩れると補間結果が壊れる。
    eachCurve((label, _key, curve) => {
      let previousT = -Infinity;
      for (const [t] of curve) {
        expect(t, `${label} has a keyframe time outside 0..1`).toBeGreaterThanOrEqual(0);
        expect(t, `${label} has a keyframe time outside 0..1`).toBeLessThanOrEqual(1);
        expect(t, `${label} has non-ascending keyframe times`).toBeGreaterThanOrEqual(previousT);
        previousT = t;
      }
    });
  });

  it("keeps gain-like curves within 0..1 and never negative elsewhere", () => {
    eachCurve((label, key, curve) => {
      for (const [, value] of curve) {
        expect(value, `${label} has a negative value`).toBeGreaterThanOrEqual(0);
        if ((GAIN_KEYS as readonly string[]).includes(key)) {
          expect(value, `${label} exceeds unity gain`).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  it("keeps lowPassHz inside the audible range at every sampled t", () => {
    // BiquadFilterNode.frequency はナイキスト周波数を超えられない。極端な値が紛れ込むと
    // 「ローパスが実質無効」になり、テーマの音色設計が崩れる。
    eachCurve((label, key, curve) => {
      if (key !== "lowPassHz") return;
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const hz = valueAt(curve, Math.min(1, t));
        expect(hz, `${label} drops below 20Hz at t=${t.toFixed(2)}`).toBeGreaterThanOrEqual(20);
        expect(hz, `${label} exceeds 20kHz at t=${t.toFixed(2)}`).toBeLessThanOrEqual(20_000);
      }
    });
  });

  it("keeps cellDensity low enough that the look-ahead scheduler cannot flood", () => {
    // engine.ts の serviceCellScheduling は「次の発火時刻が now+2秒 に届くまで」ループする。
    // 毎秒の期待発火数が大きすぎるとワンショットが洪水になるため、上限を明示的に固定する。
    eachCurve((label, key, curve) => {
      if (key !== "cellDensity") return;
      for (const [, perSec] of curve) {
        expect(perSec, `${label} schedules too many cells per second`).toBeLessThanOrEqual(2);
      }
    });
  });
});
