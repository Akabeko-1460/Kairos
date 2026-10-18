import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSoundPack } from "../tests/fixtures/sound-pack";
import { parseSoundPacks, SoundPackError } from "./index";

function expectPackError(data: unknown, path: string): void {
  expect(() => parseSoundPacks(data)).toThrow(SoundPackError);
  expect(() => parseSoundPacks(data)).toThrow(path);
}

describe("parseSoundPacks", () => {
  it("accepts the shipped packs.json without changing its values", () => {
    const document = JSON.parse(readFileSync(
      new URL("../../../apps/web/public/packs.json", import.meta.url), "utf-8",
    ));
    expect(parseSoundPacks(document)).toEqual(document.packs);
  });

  it("accepts multiple packs and omitted optional layer fields", () => {
    const packs = [createSoundPack(), createSoundPack()];
    expect(parseSoundPacks({ packs })).toEqual(packs);
  });

  it("accepts all roles, boundary loop lengths, and equal keyframe times", () => {
    const pack = createSoundPack();
    const theme = {
      ...pack.themes.study,
      bpm: 60,
      layers: [
        { role: "pad", loopSeconds: 32, takes: ["/pad.wav"], mono: true },
        { role: "texture", loopSeconds: 0.1, takes: [] },
        { role: "pulse", mono: false },
        { role: "cell", oneShots: ["/cell.wav"] },
        { role: "cue" },
      ],
      automation: { ...pack.themes.study.automation, pad: [[0, 0], [0, 1], [1, 0]] },
    };
    expect(parseSoundPacks({ packs: [{ ...pack, themes: { ...pack.themes, study: theme } }] })).toHaveLength(1);
  });

  it.each([null, [], "invalid", 1])("rejects an invalid document %j", (data) => {
    expectPackError(data, "$");
  });

  it.each([undefined, null, {}, [], "invalid"])("rejects invalid packs %j", (packs) => {
    expectPackError({ packs }, "packs");
  });

  const themePath = "packs[0].themes.study";
  const invalidFields: [string, unknown][] = [
    ["packs[0]", null],
    ["packs[0].id", " "],
    ["packs[0].id", 1],
    ["packs[0].name", undefined],
    ["packs[0].name", ""],
    ["packs[0].tuning", 0],
    ["packs[0].tuning", -1],
    ["packs[0].tuning", Infinity],
    ["packs[0].tuning", "440"],
    ["packs[0].themes", []],
    ...["study", "work", "move", "relax", "sleep"].map((id): [string, unknown] => [
      `packs[0].themes.${id}`, undefined,
    ]),
    [`${themePath}.kind`, "unknown"],
    [`${themePath}.key`, undefined],
    [`${themePath}.scale`, "unknown"],
    [`${themePath}.scale`, "toString"],
    [`${themePath}.bpm`, undefined],
    [`${themePath}.bpm`, 0],
    [`${themePath}.bpm`, -1],
    [`${themePath}.bpm`, NaN],
    [`${themePath}.ir`, "ir/test.wav"],
    [`${themePath}.layers`, {}],
    [`${themePath}.layers[0]`, null],
    [`${themePath}.layers[0].role`, "unknown"],
    [`${themePath}.layers[0].loopSeconds`, 32.1],
    [`${themePath}.layers[0].loopSeconds`, 0],
    [`${themePath}.layers[0].loopSeconds`, -1],
    [`${themePath}.layers[0].loopSeconds`, Infinity],
    [`${themePath}.layers[0].mono`, "true"],
    [`${themePath}.layers[0].takes`, "/pad.wav"],
    [`${themePath}.layers[0].takes[0]`, "pad.wav"],
    [`${themePath}.layers[0].oneShots`, null],
    [`${themePath}.layers[0].oneShots[0]`, "cell.wav"],
    ["packs[0].cues", null],
    ["packs[0].cues.phaseEnd", "cue.wav"],
    ["packs[0].cues.sessionEnd", undefined],
    [`${themePath}.automation`, undefined],
    ...["pad", "texture", "pulse", "cellDensity", "reverbWet", "lowPassHz"].map(
      (key): [string, unknown] => [`${themePath}.automation.${key}`, undefined],
    ),
    [`${themePath}.automation.pad`, [[0.5, 0], [0.4, 1]]],
    [`${themePath}.automation.pad`, [[-0.1, 0]]],
    [`${themePath}.automation.pad`, [[1.1, 0]]],
    [`${themePath}.automation.pad`, [[NaN, 0]]],
    [`${themePath}.automation.pad`, [[0, Infinity]]],
    [`${themePath}.automation.pad`, [[0, "1"]]],
    [`${themePath}.automation.pad`, [[0]]],
    [`${themePath}.automation.pad`, [[0, 1, 2]]],
    [`${themePath}.automation.pad`, [null]],
  ];

  it.each(invalidFields)("rejects invalid %s (%j) with its JSON path", (path, value) => {
    const pack = createSoundPack();
    const document = {
      packs: [{ ...pack, themes: {
        ...pack.themes,
        study: { ...pack.themes.study, layers: [{ role: "pad", takes: ["/pad.wav"], oneShots: ["/cell.wav"] }] },
      } }],
    };
    const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
    let parent = document as unknown as Record<string, unknown>;
    for (const segment of segments.slice(0, -1)) {
      parent = parent[segment] as Record<string, unknown>;
    }
    parent[segments.at(-1)!] = value;
    expectPackError(document, path);
  });

  it("validates packs beyond the first one", () => {
    expectPackError({ packs: [createSoundPack(), {}] }, "packs[1].id");
  });
});
