import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import { hasClipping, rms } from "./analysis";
import { BufferLoader } from "./buffer-loader";
import { NEUTRAL_ENVIRONMENT } from "./environment";
import { PhaseGraph } from "./phase-graph";
import type { PhaseAutomation, ThemeSoundDefinition } from "./types";

/**
 * docs/03_ARCHITECTURE.md ADR-006: Pad の複数テイクを同時ループ再生し、音量LFOで
 * 混ざり具合をドリフトさせる仕組み（`PhaseGraph` 内部の `addPadEnsemble`）の実地検証。
 * `OfflineAudioContext` で実際にレンダリングし、破綻なく音が出ることを確認する
 * （docs/04_SOUND_ENGINE.md §8 の方針: 音の一部は自動テストで検証できる）。
 */

const SAMPLE_RATE = 44100;

function makeSineBuffer(ctx: OfflineAudioContext, freqHz: number, seconds: number): AudioBuffer {
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = 0.3 * Math.sin((2 * Math.PI * freqHz * i) / SAMPLE_RATE);
  }
  return buffer;
}

function makeNoiseBuffer(ctx: OfflineAudioContext, seconds: number, peak = 0.5): AudioBuffer {
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * peak;
  return buffer;
}

const flat: PhaseAutomation["pad"] = [
  [0, 0.8],
  [1, 0.8],
];

const automation: PhaseAutomation = {
  pad: flat,
  texture: [
    [0, 0.2],
    [1, 0.2],
  ],
  pulse: [
    [0, 0],
    [1, 0],
  ],
  cellDensity: [
    [0, 0],
    [1, 0],
  ],
  reverbWet: [
    [0, 0.1],
    [1, 0.1],
  ],
  lowPassHz: [
    [0, 8000],
    [1, 8000],
  ],
};

describe("PhaseGraph pad ensemble (ADR-006 harmonic drift)", () => {
  it("renders non-silent, non-clipping audio with 3 simultaneous pad takes", async () => {
    const ctx = new OfflineAudioContext(1, 6 * SAMPLE_RATE, SAMPLE_RATE);
    const bufferLoader = new BufferLoader(ctx as unknown as BaseAudioContext);
    // BufferLoader は本来 fetch 経由で読むが、テストでは合成バッファへ差し替える
    // （private フィールドを持つため構造的モックは型的に作れない。実インスタンスの
    // public メソッドを上書きするのが最小の回避策）。
    const irBuffer = makeNoiseBuffer(ctx, 0.5, 0.3);
    bufferLoader.load = async () => irBuffer;
    bufferLoader.loadAll = async (urls: readonly string[]) =>
      urls.map((_, i) => makeSineBuffer(ctx, 220 * (i + 1), 2));

    const themeDef: ThemeSoundDefinition = {
      kind: "focus",
      key: "A",
      scale: "aeolian",
      bpm: null,
      ir: "/ir/fake.wav",
      layers: [{ role: "pad", loopSeconds: 2, takes: ["/a.wav", "/b.wav", "/c.wav"] }],
      automation,
    };

    const graph = await PhaseGraph.create({
      ctx: ctx as unknown as BaseAudioContext,
      bufferLoader,
      themeDef,
      seed: 42,
      startAt: 0,
      output: ctx.destination,
    });

    graph.scheduleMasterFade(new Float32Array([0, 1]), 0, 0.01);
    graph.tick(0.5, 0);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);

    expect(hasClipping(data)).toBe(false);
    // 全区間が無音でないこと(末尾1秒だけ見て、LFOドリフト後も音が出続けていることを確認)。
    const tailStart = 5 * SAMPLE_RATE;
    expect(rms(data.subarray(tailStart))).toBeGreaterThan(0.001);

    graph.dispose();
  });
});

describe("PhaseGraph environment modulation (ADR-010)", () => {
  async function renderWithEnvironment(rainOverlayGain: number): Promise<Float32Array> {
    const ctx = new OfflineAudioContext(1, 2 * SAMPLE_RATE, SAMPLE_RATE);
    const bufferLoader = new BufferLoader(ctx as unknown as BaseAudioContext);
    // 雨オーバーレイも含め、どの URL も同じノイズバッファへ差し替える
    // （BufferLoader.load は addEnvironmentRainLayer 用の呼び出しにも使われるため）。
    const noiseBuffer = makeNoiseBuffer(ctx, 2, 0.3);
    bufferLoader.load = async () => noiseBuffer;
    bufferLoader.loadAll = async (urls: readonly string[]) => urls.map(() => makeSineBuffer(ctx, 220, 2));

    const themeDef: ThemeSoundDefinition = {
      kind: "focus",
      key: "A",
      scale: "aeolian",
      bpm: null,
      ir: "/ir/fake.wav",
      layers: [{ role: "pad", loopSeconds: 2, takes: ["/a.wav"] }],
      automation,
    };

    const graph = await PhaseGraph.create({
      ctx: ctx as unknown as BaseAudioContext,
      bufferLoader,
      themeDef,
      seed: 7,
      startAt: 0,
      output: ctx.destination,
    });

    graph.scheduleMasterFade(new Float32Array([1, 1]), 0, 0.01);
    graph.tick(0.5, 0, { ...NEUTRAL_ENVIRONMENT, rainOverlayGain });
    // rainOverlayGain > 0 のときだけ tick() が雨バッファの遅延ロードを起動する
    // （A-4: 天候に関係なく毎テーマ無条件でロードしないための変更）。ロードは
    // BufferLoader.load() の解決を待つ非同期処理なので、実際にノードが生えるまで
    // マクロタスク境界を1つ挟んで待ってからレンダリングする。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const rendered = await ctx.startRendering();
    graph.dispose();
    return rendered.getChannelData(0);
  }

  it("raises the audible level when rainOverlayGain is turned up, without clipping", async () => {
    const withoutRain = await renderWithEnvironment(0);
    const withRain = await renderWithEnvironment(0.18); // clampModifier の上限に近い値
    expect(hasClipping(withRain)).toBe(false);
    expect(rms(withRain)).toBeGreaterThan(rms(withoutRain));
  });

  it("defaults to NEUTRAL_ENVIRONMENT (no rain overlay) when tick() omits the argument", async () => {
    const ctx = new OfflineAudioContext(1, 2 * SAMPLE_RATE, SAMPLE_RATE);
    const bufferLoader = new BufferLoader(ctx as unknown as BaseAudioContext);
    const noiseBuffer = makeNoiseBuffer(ctx, 2, 0.3);
    bufferLoader.load = async () => noiseBuffer;
    bufferLoader.loadAll = async (urls: readonly string[]) => urls.map(() => makeSineBuffer(ctx, 220, 2));

    const themeDef: ThemeSoundDefinition = {
      kind: "focus",
      key: "A",
      scale: "aeolian",
      bpm: null,
      ir: "/ir/fake.wav",
      layers: [{ role: "pad", loopSeconds: 2, takes: ["/a.wav"] }],
      automation,
    };

    const graph = await PhaseGraph.create({
      ctx: ctx as unknown as BaseAudioContext,
      bufferLoader,
      themeDef,
      seed: 7,
      startAt: 0,
      output: ctx.destination,
    });

    graph.scheduleMasterFade(new Float32Array([1, 1]), 0, 0.01);
    // 第3引数を省略しても例外にならず、環境補正なし（NEUTRAL_ENVIRONMENT）として動作すること。
    expect(() => graph.tick(0.5, 0)).not.toThrow();
    graph.dispose();
  });
});
