import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OfflineAudioContext } from "node-web-audio-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rms } from "./analysis";
import { SoundscapeEngine } from "./engine";
import type { PhaseAutomation, SoundPack, ThemeSoundDefinition } from "./types";

/**
 * `SoundscapeEngine` のマスター段（ユーザー音量 / pause-resume-stop のフェード /
 * 自動再生ポリシーで suspended になった AudioContext の復帰）に対する回帰テスト。
 *
 * `PhaseGraph` 単体は phase-graph.offline.test.ts で検証済みだが、その上位にあるマスター段は
 * これまで一切テストされておらず、実際に次の4つの不具合が入り込んでいた:
 *
 * 1. `setMasterVolume()` の値が `begin()` のフェードに上書きされ、常に全開で鳴っていた
 * 2. フェードの等パワーカーブが絶対値 0..1 なので、音量を絞っていても resume で全開に戻っていた
 * 3. `pause()` が予約した `suspend()` が `resume()` で取り消されず、再開直後に無音へ落ちていた
 * 4. suspended な context のまま `begin()`/`transitionTo()` が「成功」し、無音のまま再生中扱いになっていた
 *
 * 実 `OfflineAudioContext` を Proxy で包み、`state`/`resume`/`suspend` だけを差し替えている。
 * ノード生成とレンダリングは本物なので、測っているのは実際に出力される音そのもの。
 * （node-web-audio-api の OfflineAudioContext は resume() が解決しないため、素のまま使うと
 * init() が見切り時間いっぱい待ってしまう。）
 *
 * 音源はマスター段の検証に必要な最小構成（短い1テイクの pad と短いIR）だけを使う。
 * 本番の全レイヤーを鳴らす必要はなく、重いグラフを何度も構築するとテストが不安定になるため。
 */

const SAMPLE_RATE = 44100;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../../apps/web/public");

/** 2秒のモノラル素材。pad の1テイクとして使う。 */
const PAD_URL = "/audio/cues/soft_chime.wav";
/** 0.6秒の短いインパルス応答。convolver のテールでレンダリングが重くならないようにする。 */
const IR_URL = "/ir/room_dry.wav";

const FLAT_AUTOMATION: PhaseAutomation = {
  pad: [
    [0, 0.8],
    [1, 0.8],
  ],
  texture: [
    [0, 0],
    [1, 0],
  ],
  pulse: [
    [0, 0],
    [1, 0],
  ],
  // Cell を鳴らすとレンダリング中にワンショットが増え続けて測定がぶれるため 0 にする。
  cellDensity: [
    [0, 0],
    [1, 0],
  ],
  reverbWet: [
    [0, 0.1],
    [1, 0.1],
  ],
  lowPassHz: [
    [0, 12000],
    [1, 12000],
  ],
};

const MINIMAL_THEME: ThemeSoundDefinition = {
  kind: "focus",
  key: "A",
  scale: "aeolian",
  bpm: null,
  ir: IR_URL,
  layers: [{ role: "pad", loopSeconds: 2, takes: [PAD_URL] }],
  automation: FLAT_AUTOMATION,
};

const MINIMAL_PACK: SoundPack = {
  id: "test",
  name: "test",
  tuning: 440,
  themes: {
    study: MINIMAL_THEME,
    work: MINIMAL_THEME,
    move: MINIMAL_THEME,
    relax: MINIMAL_THEME,
    sleep: MINIMAL_THEME,
  },
  cues: { phaseEnd: PAD_URL, sessionEnd: PAD_URL },
};

/** `/audio/...`・`/ir/...` を apps/web/public の実ファイルへ解決する fetch スタブ。 */
function installPublicAssetFetch(): void {
  vi.stubGlobal("fetch", async (url: string) => {
    const file = readFileSync(path.join(PUBLIC_DIR, url.replace(/^\//, "")));
    const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    return { ok: true, status: 200, arrayBuffer: async () => arrayBuffer };
  });
}

interface ControllableContext {
  readonly proxy: BaseAudioContext;
  readonly real: OfflineAudioContext;
  readonly calls: { resume: number; suspend: number };
  state: () => AudioContextState;
}

/**
 * 実 OfflineAudioContext を包み、`state`/`resume()`/`suspend()` だけを観測・制御可能にする。
 * それ以外（ノード生成・decodeAudioData・currentTime・destination）はすべて本物へ委譲する。
 */
function controllableContext(lengthSec: number): ControllableContext {
  const real = new OfflineAudioContext(1, Math.round(lengthSec * SAMPLE_RATE), SAMPLE_RATE);
  let state: AudioContextState = "suspended";
  const calls = { resume: 0, suspend: 0 };

  const proxy = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === "state") return state;
      if (prop === "resume") {
        return async () => {
          calls.resume += 1;
          state = "running";
        };
      }
      if (prop === "suspend") {
        return async () => {
          calls.suspend += 1;
          state = "suspended";
        };
      }
      const value = Reflect.get(target, prop, receiver === proxy ? target : receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as BaseAudioContext;

  return { proxy, real, calls, state: () => state };
}

async function createEngine(ctx: ControllableContext): Promise<SoundscapeEngine> {
  const engine = new SoundscapeEngine({ createContext: () => ctx.proxy, disableWorker: true });
  await engine.init();
  await engine.loadPack(MINIMAL_PACK);
  return engine;
}

/**
 * レンダリング後は必ずエンジンを破棄してティッカーを止める。放置すると `IntervalTicker` が
 * レンダリング済み（＝もう時間が進まない）OfflineAudioContext を触り続ける。
 */
async function renderAndDispose(ctx: ControllableContext, engine: SoundscapeEngine): Promise<Float32Array> {
  const rendered = await ctx.real.startRendering();
  await engine.dispose();
  return rendered.getChannelData(0);
}

function peakOf(data: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  return peak;
}

beforeEach(() => {
  installPublicAssetFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SoundscapeEngine master volume", () => {
  /**
   * 再生開始前に決めた音量が、実際にレンダリングされる音へ反映されること。
   * 「音量バーを絞ってから再生を始めても全開で鳴る」不具合の回帰テスト
   * （原因: begin() のフェードがユーザー音量と同じ AudioParam を 1.0 へ上書きしていた）。
   */
  async function renderAtVolume(volume: number): Promise<Float32Array> {
    const ctx = controllableContext(4);
    const engine = await createEngine(ctx);
    engine.setMasterVolume(volume);
    await engine.begin("study", 1);
    engine.tick(0.5);
    return renderAndDispose(ctx, engine);
  }

  it("scales the rendered output by the volume set before playback starts", async () => {
    const quiet = await renderAtVolume(0.25);
    const loud = await renderAtVolume(1);

    // begin() のフェードイン（1.5秒）が終わった後の定常区間だけを見る。
    const from = Math.round(2.5 * SAMPLE_RATE);
    const quietRms = rms(quiet.subarray(from));
    const loudRms = rms(loud.subarray(from));

    expect(loudRms).toBeGreaterThan(0.0001); // そもそも音が出ていること
    expect(quietRms / loudRms).toBeCloseTo(0.25, 1);
  }, 30_000);

  /**
   * フェードは「現在の音量から」でなければならない。等パワーカーブは絶対値 0..1 なので、
   * ユーザー音量と同じ AudioParam に流し込むと、音量を絞っていても一度 1.0 まで
   * 跳ね上がってから落ちる／戻る。
   */
  it("never exceeds the user volume while pausing and resuming", async () => {
    const ctx = controllableContext(4);
    const engine = await createEngine(ctx);
    engine.setMasterVolume(0.2);
    await engine.begin("study", 1);
    engine.tick(0.5);
    await engine.pause(0.2);
    await engine.resume(0.2);

    const data = await renderAndDispose(ctx, engine);
    const fullScale = await renderAtVolume(1);

    // 音量 0.2 を指定している以上、全開時のピークの 0.2 倍あたりが上限。
    // 跳ね上がりが起きていればここを大きく超える。
    expect(peakOf(data)).toBeLessThan(peakOf(fullScale) * 0.35);
  }, 30_000);
});

describe("SoundscapeEngine cue playback", () => {
  /**
   * 通知音はテーマのフェードバスを経由しないので、停止（フェードアウト）と同時に鳴らしても
   * 一緒に消えてはいけない。Timer は「時間切れ → 音を止める → 終了を知らせる」という順で
   * 呼ぶため、ここが守られていないと肝心の通知が聞こえなくなる。
   */
  it("stays audible even when the theme is being faded out at the same time", async () => {
    const ctx = controllableContext(3);
    const engine = await createEngine(ctx);
    engine.setMasterVolume(1);
    await engine.begin("study", 1);
    engine.tick(0.5);
    await engine.stop(0.2); // テーマをフェードアウトさせる
    await engine.playCue("sessionEnd", { gain: 0.9 });

    const data = await renderAndDispose(ctx, engine);
    // フェードが終わったあとの区間に、通知音が実際に鳴っていること
    const afterFade = data.subarray(Math.round(0.6 * SAMPLE_RATE));
    expect(rms(afterFade)).toBeGreaterThan(0.01);
  }, 30_000);

  it("schedules repeats at the requested interval", async () => {
    const ctx = controllableContext(4);
    const engine = await createEngine(ctx);
    engine.setMasterVolume(1);
    await engine.playCue("sessionEnd", { gain: 0.9, times: 3, intervalSec: 1 });

    const data = await renderAndDispose(ctx, engine);
    // 1秒ごとに3回鳴るので、各回の開始直後の窓はいずれも無音でない
    for (const sec of [0, 1, 2]) {
      const from = Math.round(sec * SAMPLE_RATE);
      const window = data.subarray(from, from + Math.round(0.2 * SAMPLE_RATE));
      expect(rms(window), `${sec}秒地点で通知音が鳴っていない`).toBeGreaterThan(0.01);
    }
  }, 30_000);
});

describe("SoundscapeEngine pause/resume lifecycle", () => {
  /**
   * `pause()` は fadeOutSec 後に `suspend()` を予約する。その待ち時間中に `resume()` されたら
   * 予約は取り消されなければならない。取り消さないと「resume したのに直後に suspend されて
   * 無音のまま復帰できない」状態になる。
   */
  it("cancels the pending suspend when resume() happens during the fade-out", async () => {
    vi.useFakeTimers();
    const ctx = controllableContext(1);
    const engine = await createEngine(ctx);

    await engine.pause(0.4);
    await engine.resume(0.4);
    await vi.advanceTimersByTimeAsync(2000);

    expect(ctx.state()).toBe("running");
    expect(ctx.calls.suspend).toBe(0);
    await engine.dispose();
  }, 30_000);

  /**
   * 自動再生ポリシーで suspended に落ちた AudioContext は、次に「鳴らす」要求が来た時点で
   * 必ず running へ戻さなければならない。戻さないと begin()/transitionTo() が成功したように
   * 見えて実際には無音になる（UI 上は再生中の表示のまま）。
   */
  it("resumes a suspended context when a new playback request arrives", async () => {
    const ctx = controllableContext(2);
    const engine = await createEngine(ctx);
    await engine.begin("study", 1);
    await engine.pause(0.05);
    // pause が予約した suspend を実際に発火させ、suspended まで落とす
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(ctx.state()).toBe("suspended");

    await engine.transitionTo("work", 2, 1);
    expect(ctx.state()).toBe("running");
    await engine.dispose();
  }, 30_000);
});
