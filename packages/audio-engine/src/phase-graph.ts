import { valueAt } from "./automation";
import { BufferLoader } from "./buffer-loader";
import { CellScheduler } from "./cell-scheduler";
import { mulberry32 } from "./prng";
import { scaleSemitones } from "./scales";
import type { LayerSpec, PhaseAutomation, ThemeSoundDefinition } from "./types";

const LOOP_CROSSFADE_TAIL_SEC = 0; // Phase 2 で LoopManager のテイクローテーションと合わせて拡張する
const DETUNE_RANGE = 0.006; // ±0.3%

/**
 * 1フェーズ分のノードグラフ（docs/04_SOUND_ENGINE.md §2）。
 *
 *   pad/texture/pulse/cell BufferSource ─► layerGain ─┐
 *                                                       ├─► mixBus ─► filter ─┬─► dry ──────┐
 *                                                       ┘                     └─► send─►conv─┤
 *                                                                                            ▼
 *                                                                                    phaseMasterGain（クロスフェード用）
 *
 * クロスフェード対象は phaseMasterGain のみ。層ごとの自動化は別 AudioParam なので競合しない
 * （docs/CLAUDE.md: setValueCurveAtTime 実行中の AudioParam に他の予約を入れると例外）。
 */
export class PhaseGraph {
  readonly phaseMasterGain: GainNode;
  readonly mixBus: GainNode;
  readonly cellScheduler: CellScheduler;
  readonly automation: PhaseAutomation;

  private readonly ctx: BaseAudioContext;
  private readonly layerGains = new Map<string, GainNode>();
  private readonly sources: AudioBufferSourceNode[] = [];
  private readonly filterNode: BiquadFilterNode;
  private readonly dryGain: GainNode;
  private readonly sendGain: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly cellBuffers: readonly AudioBuffer[];
  private readonly rng: () => number;
  private disposed = false;

  private constructor(params: {
    ctx: BaseAudioContext;
    automation: PhaseAutomation;
    cellBuffers: readonly AudioBuffer[];
    scaleName: string;
    seed: number;
    startAt: number;
  }) {
    this.ctx = params.ctx;
    this.automation = params.automation;
    this.cellBuffers = params.cellBuffers;
    this.rng = mulberry32(params.seed);

    this.mixBus = params.ctx.createGain();
    this.mixBus.gain.value = 1;

    this.filterNode = params.ctx.createBiquadFilter();
    this.filterNode.type = "lowpass";
    this.filterNode.frequency.value = valueAt(params.automation.lowPassHz, 0);

    this.dryGain = params.ctx.createGain();
    this.sendGain = params.ctx.createGain();
    this.sendGain.gain.value = valueAt(params.automation.reverbWet, 0);
    this.convolver = params.ctx.createConvolver();

    this.phaseMasterGain = params.ctx.createGain();
    this.phaseMasterGain.gain.value = 0; // begin()/transitionTo() 側でフェードインする

    this.mixBus.connect(this.filterNode);
    this.filterNode.connect(this.dryGain);
    this.filterNode.connect(this.sendGain);
    this.sendGain.connect(this.convolver);
    this.dryGain.connect(this.phaseMasterGain);
    this.convolver.connect(this.phaseMasterGain);

    this.cellScheduler = new CellScheduler(this.rng, scaleSemitones(params.scaleName), params.startAt);
  }

  static async create(params: {
    ctx: BaseAudioContext;
    bufferLoader: BufferLoader;
    themeDef: ThemeSoundDefinition;
    seed: number;
    startAt: number;
    output: AudioNode;
  }): Promise<PhaseGraph> {
    const rngForTakes = mulberry32(params.seed);
    const cellSpec = params.themeDef.layers.find((l) => l.role === "cell");
    const [irBuffer, cellBuffers] = await Promise.all([
      params.bufferLoader.load(params.themeDef.ir),
      cellSpec?.oneShots ? params.bufferLoader.loadAll(cellSpec.oneShots) : Promise.resolve([]),
    ]);

    const graph = new PhaseGraph({
      ctx: params.ctx,
      automation: params.themeDef.automation,
      cellBuffers,
      scaleName: params.themeDef.scale,
      seed: params.seed,
      startAt: params.startAt,
    });
    graph.convolver.buffer = irBuffer;
    graph.phaseMasterGain.connect(params.output);

    for (const layer of params.themeDef.layers) {
      if (layer.role === "cell" || layer.role === "cue") continue; // ワンショット系はループ層と別扱い
      if (!layer.takes || layer.takes.length === 0) continue;
      const takeUrl = layer.takes[Math.floor(rngForTakes() * layer.takes.length)]!;
      const buffer = await params.bufferLoader.load(takeUrl);
      graph.addLoopLayer(layer, buffer, params.startAt, rngForTakes);
    }

    return graph;
  }

  private addLoopLayer(
    layer: LayerSpec,
    buffer: AudioBuffer,
    startAt: number,
    rng: () => number,
  ): void {
    const layerGain = this.ctx.createGain();
    layerGain.gain.value = 0;
    layerGain.connect(this.mixBus);
    this.layerGains.set(layer.role, layerGain);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = layer.loopSeconds ?? buffer.duration;
    // 微小デチューン。同じテイクを別レイヤーで使っても位相が揃って聴こえないようにする。
    source.playbackRate.value = 1 + (rng() - 0.5) * DETUNE_RANGE;
    source.connect(layerGain);
    source.start(startAt);
    this.sources.push(source);
  }

  /** useTimer から約10Hzで呼ばれる。t は 0.0–1.0。 */
  tick(t: number, now: number): void {
    if (this.disposed) return;
    const RAMP_SEC = 0.15; // 短いランプでジッパーノイズを防ぐ（10Hz呼び出しに対して十分短い）
    const target = now + RAMP_SEC;

    for (const role of ["pad", "texture", "pulse"] as const) {
      const gainNode = this.layerGains.get(role);
      if (!gainNode) continue;
      const value = valueAt(this.automation[role], t);
      gainNode.gain.linearRampToValueAtTime(Math.max(0, value), target);
    }

    this.filterNode.frequency.linearRampToValueAtTime(
      Math.max(20, valueAt(this.automation.lowPassHz, t)),
      target,
    );
    this.sendGain.gain.linearRampToValueAtTime(
      Math.max(0, valueAt(this.automation.reverbWet, t)),
      target,
    );
  }

  currentCellDensity(t: number): number {
    return valueAt(this.automation.cellDensity, t);
  }

  /** CellScheduler が決めた時刻に、スケール内の音程でワンショットを1つ鳴らす。 */
  scheduleCellOneShot(when: number): void {
    if (this.disposed || this.cellBuffers.length === 0) return;
    const event = this.cellScheduler.pick();
    const bufIdx = Math.floor(this.rng() * this.cellBuffers.length);
    const buffer = this.cellBuffers[bufIdx]!;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** (event.semitone / 12);

    const gain = this.ctx.createGain();
    gain.gain.value = event.gain;

    if ("createStereoPanner" in this.ctx) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = event.pan;
      source.connect(gain).connect(panner).connect(this.mixBus);
    } else {
      source.connect(gain).connect(this.mixBus);
    }

    source.start(when);
    this.sources.push(source);
  }

  /** 等パワーカーブでフェードイン/アウトする。crossfader.ts から呼ばれる。 */
  scheduleMasterFade(curve: Float32Array, startTime: number, durationSec: number): void {
    this.phaseMasterGain.gain.cancelScheduledValues(startTime);
    this.phaseMasterGain.gain.setValueCurveAtTime(curve, startTime, durationSec);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // 既に停止済みの場合は無視
      }
      source.disconnect();
    }
    this.sources.length = 0;
    this.layerGains.forEach((g) => g.disconnect());
    this.layerGains.clear();
    this.mixBus.disconnect();
    this.filterNode.disconnect();
    this.dryGain.disconnect();
    this.sendGain.disconnect();
    this.convolver.disconnect();
    this.phaseMasterGain.disconnect();
  }
}

void LOOP_CROSSFADE_TAIL_SEC; // Phase 2 (LoopManager) で使用予定
