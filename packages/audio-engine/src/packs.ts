import { SCALES } from "./scales";
import { THEME_IDS, type LayerRole, type PhaseAutomation, type SoundPack } from "./types";

const LAYER_ROLES = ["pad", "texture", "pulse", "cell", "cue"] as const satisfies readonly LayerRole[];
const AUTOMATION_KEYS = [
  "pad", "texture", "pulse", "cellDensity", "reverbWet", "lowPassHz",
] as const satisfies readonly (keyof PhaseAutomation)[];

export class SoundPackError extends Error {
  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`);
    this.name = "SoundPackError";
  }
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SoundPackError(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SoundPackError(path, "expected an array");
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SoundPackError(path, "expected a non-empty string");
  }
  return value;
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SoundPackError(path, "expected a finite number");
  }
  return value;
}

function positiveNumberAt(value: unknown, path: string): number {
  const number = numberAt(value, path);
  if (number <= 0) throw new SoundPackError(path, "expected a number greater than 0");
  return number;
}

function validateAssetPath(value: unknown, path: string): void {
  if (!stringAt(value, path).startsWith("/")) {
    throw new SoundPackError(path, "expected an asset path starting with /");
  }
}

function validateLayer(value: unknown, path: string): void {
  const layer = objectAt(value, path);
  if (!LAYER_ROLES.some((role) => role === layer.role)) {
    throw new SoundPackError(`${path}.role`, `expected one of ${LAYER_ROLES.join(", ")}`);
  }
  if (layer.loopSeconds !== undefined) {
    if (positiveNumberAt(layer.loopSeconds, `${path}.loopSeconds`) > 32) {
      throw new SoundPackError(`${path}.loopSeconds`, "expected at most 32 seconds");
    }
  }
  if (layer.mono !== undefined && typeof layer.mono !== "boolean") {
    throw new SoundPackError(`${path}.mono`, "expected a boolean");
  }
  for (const key of ["takes", "oneShots"] as const) {
    if (layer[key] === undefined) continue;
    const paths = arrayAt(layer[key], `${path}.${key}`);
    for (let index = 0; index < paths.length; index++) {
      validateAssetPath(paths[index], `${path}.${key}[${index}]`);
    }
  }
}

function validateKeyframes(value: unknown, path: string): void {
  const frames = arrayAt(value, path);
  let previousTime = 0;
  for (let index = 0; index < frames.length; index++) {
    const framePath = `${path}[${index}]`;
    const frame = arrayAt(frames[index], framePath);
    if (frame.length !== 2) throw new SoundPackError(framePath, "expected [t, value]");
    const time = numberAt(frame[0], `${framePath}[0]`);
    if (time < 0 || time > 1 || time < previousTime) {
      throw new SoundPackError(`${framePath}[0]`, "expected t in 0..1 in ascending order");
    }
    numberAt(frame[1], `${framePath}[1]`);
    previousTime = time;
  }
}

function validateTheme(value: unknown, path: string): void {
  const theme = objectAt(value, path);
  if (theme.kind !== "focus" && theme.kind !== "break") {
    throw new SoundPackError(`${path}.kind`, "expected focus or break");
  }
  stringAt(theme.key, `${path}.key`);
  const scale = stringAt(theme.scale, `${path}.scale`);
  if (!Object.hasOwn(SCALES, scale)) {
    throw new SoundPackError(`${path}.scale`, "expected a key of SCALES");
  }
  if (theme.bpm !== null) positiveNumberAt(theme.bpm, `${path}.bpm`);
  validateAssetPath(theme.ir, `${path}.ir`);
  const layers = arrayAt(theme.layers, `${path}.layers`);
  for (let index = 0; index < layers.length; index++) {
    validateLayer(layers[index], `${path}.layers[${index}]`);
  }
  const automation = objectAt(theme.automation, `${path}.automation`);
  for (const key of AUTOMATION_KEYS) {
    validateKeyframes(automation[key], `${path}.automation.${key}`);
  }
}

/** Validate the packs.json envelope before any pack reaches the audio engine. */
export function parseSoundPacks(data: unknown): SoundPack[] {
  const document = objectAt(data, "$");
  const packs = arrayAt(document.packs, "packs");
  if (packs.length === 0) throw new SoundPackError("packs", "expected at least one sound pack");
  for (let index = 0; index < packs.length; index++) {
    const path = `packs[${index}]`;
    const pack = objectAt(packs[index], path);
    stringAt(pack.id, `${path}.id`);
    stringAt(pack.name, `${path}.name`);
    positiveNumberAt(pack.tuning, `${path}.tuning`);
    const themes = objectAt(pack.themes, `${path}.themes`);
    for (const themeId of THEME_IDS) {
      validateTheme(themes[themeId], `${path}.themes.${themeId}`);
    }
    const cues = objectAt(pack.cues, `${path}.cues`);
    validateAssetPath(cues.phaseEnd, `${path}.cues.phaseEnd`);
    validateAssetPath(cues.sessionEnd, `${path}.cues.sessionEnd`);
  }
  // All SoundPack fields, including optional LayerSpec fields, have been checked above.
  return packs as SoundPack[];
}
