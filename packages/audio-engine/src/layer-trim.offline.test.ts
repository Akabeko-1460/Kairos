import { OfflineAudioContext } from "node-web-audio-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rms } from "./analysis";
import { BufferLoader } from "./buffer-loader";
import { SoundscapeEngine } from "./engine";
import { PhaseGraph } from "./phase-graph";
import type { LayerRole, SoundPack, ThemeSoundDefinition } from "./types";

const SAMPLE_RATE = 16000;
const engines: SoundscapeEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.dispose();
  vi.restoreAllMocks();
});

function fixture(role: LayerRole) {
  const real = new OfflineAudioContext(1, 3 * SAMPLE_RATE, SAMPLE_RATE);
  const ctx = new Proxy(real, {
    get(target, key) {
      if (key === "state") return "running";
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as BaseAudioContext;
  const tone = real.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
  const samples = tone.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.1 * Math.sin(2 * Math.PI * 220 * i / SAMPLE_RATE);
  const ir = real.createBuffer(1, 128, SAMPLE_RATE);
  ir.getChannelData(0)[0] = 1;
  vi.spyOn(BufferLoader.prototype, "load").mockImplementation(async (url) => url === "/ir" ? ir : tone);
  const theme: ThemeSoundDefinition = {
    kind: "focus", key: "A", scale: "aeolian", bpm: null, ir: "/ir",
    layers: [role === "cell" ? { role, oneShots: ["/tone"] } : { role, takes: ["/tone"] }],
    automation: {
      pad: [[0, 0.8], [1, 0.4]], texture: [[0, 0.8], [1, 0.4]],
      pulse: [[0, 0.8], [1, 0.4]], cellDensity: [[0, 0], [1, 0]],
      lowPassHz: [[0, 7000], [1, 7000]], reverbWet: [[0, 0], [1, 0]],
    },
  };
  const pack: SoundPack = {
    id: "trim-test", name: "trim-test", tuning: 440,
    themes: { study: theme, work: theme, move: theme, relax: theme, sleep: theme },
    cues: { phaseEnd: "/tone", sessionEnd: "/tone" },
  };
  return { real, ctx, theme, pack };
}

async function renderEngine(role: LayerRole, trim: number, transition = false) {
  const { real, ctx, pack } = fixture(role);
  const engine = new SoundscapeEngine({ createContext: () => ctx, disableWorker: true });
  engines.push(engine);
  engine.setLayerTrim(role, trim);
  await engine.init();
  await engine.loadPack(pack);
  await engine.begin("study", 42);
  engine.tick(0.5);
  if (transition) {
    await engine.transitionTo("work", 42, 0.1);
    engine.tick(0.5);
  }
  const rendered = await real.startRendering();
  return rms(rendered.getChannelData(0).subarray(2 * SAMPLE_RATE));
}

describe("layer trims with OfflineAudioContext", () => {
  it.each(["pad", "texture", "pulse"] as const)("mutes %s and preserves its automation at half volume", async (role) => {
    const full = await renderEngine(role, 1);
    const half = await renderEngine(role, 0.5);
    const muted = await renderEngine(role, 0);
    expect(full).toBeGreaterThan(0.01);
    expect(half / full).toBeCloseTo(0.5, 3);
    expect(muted).toBeLessThan(0.000001);
  });

  it("targets half the texture automation value on the next tick", async () => {
    const { ctx, real, theme } = fixture("texture");
    const graph = await PhaseGraph.create({
      ctx, bufferLoader: new BufferLoader(ctx), themeDef: theme, seed: 42, startAt: 0, output: ctx.destination,
    });
    const paramPrototype = Object.getPrototypeOf(real.createGain().gain) as AudioParam;
    const schedule = vi.spyOn(paramPrototype, "setTargetAtTime");
    graph.setLayerTrim("texture", 0.5);
    schedule.mockClear();
    graph.tick(0.5, 0);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]![0]).toBeCloseTo(0.3, 12);
    expect(schedule.mock.calls[0]!.slice(1)).toEqual([0, 0.1]);
    graph.dispose();
  });

  it("inherits muted and partial trims in the graph created by transitionTo", async () => {
    const full = await renderEngine("pad", 1, true);
    expect(full).toBeGreaterThan(0.01);
    expect(await renderEngine("pad", 0, true)).toBeLessThan(0.000001);
    expect(await renderEngine("pad", 0.5, true) / full).toBeCloseTo(0.5, 3);
  });

  it.each([0, 0.5, 1])("applies trim %s to an already scheduled cell one-shot", async (trim) => {
    const { real, ctx, theme } = fixture("cell");
    const graph = await PhaseGraph.create({
      ctx, bufferLoader: new BufferLoader(ctx), themeDef: theme, seed: 42, startAt: 0, output: ctx.destination,
    });
    graph.phaseMasterGain.gain.value = 1;
    graph.scheduleCellOneShot(1);
    graph.setLayerTrim("cell", trim);
    const rendered = await real.startRendering();
    const level = rms(rendered.getChannelData(0));
    if (trim === 0) expect(level).toBeLessThan(0.000001);
    else expect(level).toBeGreaterThan(0.001);
    graph.dispose();
  });
});
