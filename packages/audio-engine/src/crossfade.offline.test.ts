import { OfflineAudioContext } from "node-web-audio-api";
import { describe, expect, it } from "vitest";
import { hasClipping, rmsWindow, toDb } from "./analysis";
import { equalPowerCurve } from "./equal-power";
import { mulberry32 } from "./prng";

/**
 * Phase 0 スパイクA / docs/05_IMPLEMENTATION_PLAN.md タスク0-5。
 *
 * `OfflineAudioContext` を Node 上で動かす `node-web-audio-api`（web-audio-api-rs のバインディング）を使い、
 * 実際の GainNode.setValueCurveAtTime によるクロスフェードをレンダリングして、
 * docs/04_SOUND_ENGINE.md §8 の受け入れ基準（クロスフェード区間のRMSが ±1.5dB 以内、クリッピング無し）を検証する。
 *
 * 素材は本番のステムではなく、同一RMSの独立なホワイトノイズ2本を使う。理由:
 * - 実際のステムに依存せずこのテストだけで完結させたい（Phase 0 時点ではまだ本番素材がない）
 * - 正弦波2本だと周波数干渉（うなり）でRMSが自然に揺れ、クロスフェード由来の谷と区別しにくい
 * - ホワイトノイズはウィンドウRMSが安定するため、「谷が本当に無いか」を検出する感度が高い
 */

const SAMPLE_RATE = 44100;
const DURATION_SEC = 9;
const CROSSFADE_START_SEC = 1;
const CROSSFADE_SEC = 6;
const TARGET_RMS = 0.2; // -20 LUFS 前後を狙う実素材の運用（docs/04_SOUND_ENGINE.md §7.1）を模した控えめな振幅
const NOISE_AMPLITUDE = TARGET_RMS * Math.sqrt(3); // 一様分布 [-a, a] の RMS = a/√3

function createNoiseBuffer(ctx: OfflineAudioContext, seed: number): AudioBuffer {
  const length = Math.ceil(DURATION_SEC * SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  const rng = mulberry32(seed);
  for (let i = 0; i < length; i++) {
    data[i] = (rng() * 2 - 1) * NOISE_AMPLITUDE;
  }
  return buffer;
}

describe("Phase 0 スパイクA: OfflineAudioContext による実クロスフェード検証", () => {
  it("crossfade region RMS stays within ±1.5dB of steady-state, and no clipping occurs", async () => {
    const ctx = new OfflineAudioContext(1, DURATION_SEC * SAMPLE_RATE, SAMPLE_RATE);

    const outgoingBuffer = createNoiseBuffer(ctx, 1);
    const incomingBuffer = createNoiseBuffer(ctx, 2);

    const outgoingSource = ctx.createBufferSource();
    outgoingSource.buffer = outgoingBuffer;
    const incomingSource = ctx.createBufferSource();
    incomingSource.buffer = incomingBuffer;

    const outgoingGain = ctx.createGain();
    const incomingGain = ctx.createGain();
    outgoingGain.gain.value = 1;
    incomingGain.gain.value = 0;

    outgoingSource.connect(outgoingGain).connect(ctx.destination);
    incomingSource.connect(incomingGain).connect(ctx.destination);

    outgoingSource.start(0);
    incomingSource.start(0);

    outgoingGain.gain.setValueCurveAtTime(equalPowerCurve(false), CROSSFADE_START_SEC, CROSSFADE_SEC);
    incomingGain.gain.setValueCurveAtTime(equalPowerCurve(true), CROSSFADE_START_SEC, CROSSFADE_SEC);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);

    expect(hasClipping(data)).toBe(false);

    const WINDOW_SAMPLES = Math.round(0.1 * SAMPLE_RATE); // 100ms 窓
    const sampleAt = (sec: number) => rmsWindow(data, Math.round(sec * SAMPLE_RATE) - WINDOW_SAMPLES / 2, WINDOW_SAMPLES);

    // 定常状態の基準値: crossfade 前(outgoing のみ)と crossfade 後(incoming のみ)
    const steadyBefore = sampleAt(0.5);
    const steadyAfter = sampleAt(8.5);

    // 定常状態同士もほぼ同じ振幅であるはず（同じ TARGET_RMS のノイズなので）
    expect(Math.abs(toDb(steadyAfter) - toDb(steadyBefore))).toBeLessThan(1.5);

    const referenceDb = toDb((steadyBefore + steadyAfter) / 2);

    // crossfade 区間内の複数点で RMS が基準から ±1.5dB 以内（谷ができていないこと）
    const checkpoints = [1.5, 2.5, 3.5, 4.0, 4.5, 5.0, 5.5, 6.5, 7.5];
    for (const sec of checkpoints) {
      const measuredDb = toDb(sampleAt(sec));
      expect(
        Math.abs(measuredDb - referenceDb),
        `t=${sec}s で ${measuredDb.toFixed(2)}dB (基準 ${referenceDb.toFixed(2)}dB からのズレが大きすぎる)`,
      ).toBeLessThan(1.5);
    }
  });

  it("regression: a naive linear crossfade WOULD fail the ±1.5dB check at the midpoint", async () => {
    // 対照実験: 等パワーでなく線形カーブを使うとどうなるかを同じレンダリングパイプラインで確認する。
    // これが Phase 0 で等パワーカーブを選ぶ理由の実証。
    const ctx = new OfflineAudioContext(1, DURATION_SEC * SAMPLE_RATE, SAMPLE_RATE);
    const outgoingBuffer = createNoiseBuffer(ctx, 1);
    const incomingBuffer = createNoiseBuffer(ctx, 2);

    const outgoingSource = ctx.createBufferSource();
    outgoingSource.buffer = outgoingBuffer;
    const incomingSource = ctx.createBufferSource();
    incomingSource.buffer = incomingBuffer;

    const outgoingGain = ctx.createGain();
    const incomingGain = ctx.createGain();
    outgoingGain.gain.value = 1;
    incomingGain.gain.value = 0;

    outgoingSource.connect(outgoingGain).connect(ctx.destination);
    incomingSource.connect(incomingGain).connect(ctx.destination);
    outgoingSource.start(0);
    incomingSource.start(0);

    // 線形カーブ
    const linearOut = new Float32Array([1, 0]);
    const linearIn = new Float32Array([0, 1]);
    outgoingGain.gain.setValueCurveAtTime(linearOut, CROSSFADE_START_SEC, CROSSFADE_SEC);
    incomingGain.gain.setValueCurveAtTime(linearIn, CROSSFADE_START_SEC, CROSSFADE_SEC);

    const rendered = await ctx.startRendering();
    const data = rendered.getChannelData(0);
    const WINDOW_SAMPLES = Math.round(0.1 * SAMPLE_RATE);
    const sampleAt = (sec: number) => rmsWindow(data, Math.round(sec * SAMPLE_RATE) - WINDOW_SAMPLES / 2, WINDOW_SAMPLES);

    const steadyBefore = sampleAt(0.5);
    const midDb = toDb(sampleAt(4.0)); // crossfade 中間点 (1s + 6s/2 = 4s)
    const referenceDb = toDb(steadyBefore);

    // 線形フェードは中間で -3dB 前後落ち込む → ±1.5dB を超えて失敗するはず
    expect(Math.abs(midDb - referenceDb)).toBeGreaterThan(1.5);
  });
});
