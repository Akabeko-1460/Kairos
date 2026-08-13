import { BufferLoader } from "./buffer-loader";
import { equalPowerCurve } from "./equal-power";
import { NEUTRAL_ENVIRONMENT, type EnvironmentModifier } from "./environment";
import { createCompressorLimiter, type Limiter } from "./limiter";
import { PhaseGraph } from "./phase-graph";
import type { LayerRole, SoundPack, ThemeId } from "./types";
import { IntervalTicker, WorkerTicker, type Ticker } from "./worker-ticker";

/** 常に2〜3秒先までイベントを予約しておく（docs/04_SOUND_ENGINE.md §6.1）。 */
const SCHEDULE_AHEAD_SEC = 2.0;
/** フェーズ切替の既定クロスフェード秒数。 */
const DEFAULT_CROSSFADE_SEC = 6;
/** 移行の開始は Focus の t=1.0 到達時ではなく t≈0.985 から（docs/04_SOUND_ENGINE.md §6.4）。呼び出し側の目安値として公開。 */
export const RECOMMENDED_TRANSITION_T = 0.985;

export interface SoundscapeEngineOptions {
  /** テスト用に AudioContext を差し替え可能にする。省略時はブラウザの AudioContext を使う。 */
  createContext?: () => BaseAudioContext;
  /** テスト/SSR環境で Worker が使えない場合に true にすると IntervalTicker にフォールバックする。 */
  disableWorker?: boolean;
}

/** docs/04_SOUND_ENGINE.md §5 のインターフェースに準拠。 */
export class SoundscapeEngine {
  private ctx: BaseAudioContext | null = null;
  private masterGain: GainNode | null = null;
  private limiter: Limiter | null = null;
  private analyser: AnalyserNode | null = null;
  private bufferLoader: BufferLoader | null = null;
  private ticker: Ticker | null = null;

  private pack: SoundPack | null = null;
  private currentGraph: PhaseGraph | null = null;
  private outgoingGraph: PhaseGraph | null = null;
  private currentTheme: ThemeId | null = null;
  private lastT = 0;
  private disposeOutgoingTimer: ReturnType<typeof setTimeout> | null = null;
  /** getDebugInfo() が無駄な再描画を避けるために使う直近スナップショットのキャッシュ。 */
  private lastDebugInfo: {
    contextTime: number;
    contextState: string;
    nextCellEventTime: number | null;
    currentTheme: ThemeId | null;
  } | null = null;

  constructor(private readonly options: SoundscapeEngineOptions = {}) {}

  /** ユーザー操作（Startボタン）を起点にのみ呼ぶこと。自動再生ポリシー対策。 */
  async init(): Promise<void> {
    if (this.ctx) return;
    const ctx = this.options.createContext
      ? this.options.createContext()
      : new AudioContext();
    this.ctx = ctx;

    if ("resume" in ctx) {
      // 呼び出し元のジェスチャーがSPA遷移等で失われていた場合、resume() が長時間
      // pending のまま解決しないブラウザがある。init() 自体をそれで止め続けると
      // engineReady が永遠に true にならず、UIが「何をしても無反応」に見えてしまうため、
      // 一定時間で見切りをつけて先へ進む（resume自体は裏で解決を試み続ける）。
      await Promise.race([
        (ctx as AudioContext).resume().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]);
      // まだ suspended のままなら、このページ上での次の実操作で確実に再開させる保険を張る。
      // Chrome は自動再生ポリシー上この再開をブラウザ側で行うことがあるが、Firefox/Safari 等は
      // resume() 呼び出し自体がジェスチャーのコールスタック内にあることを要求するため、
      // アプリ側でも明示的に listener を張っておく。
      if ((ctx as AudioContext).state !== "running") {
        this.armGestureUnlock(ctx as AudioContext);
      }
    }

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.limiter = createCompressorLimiter(ctx);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    this.masterGain.connect(this.limiter.inputNode);
    this.limiter.outputNode.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.bufferLoader = new BufferLoader(ctx);

    this.ticker =
      this.options.disableWorker || typeof Worker === "undefined"
        ? new IntervalTicker()
        : new WorkerTicker();
    this.ticker.start(() => this.serviceCellScheduling());
  }

  /**
   * suspended のまま init() を抜けた AudioContext を、このページ上で次に起きる実際の
   * ユーザー操作（クリック・タップ・キー入力）で必ず再開させる。running になった時点で
   * listener を外す。SSR環境では document が無いため何もしない。
   */
  private armGestureUnlock(ctx: AudioContext): void {
    if (typeof document === "undefined") return;
    const events: Array<"pointerdown" | "keydown" | "touchend"> = ["pointerdown", "keydown", "touchend"];
    const retry = () => {
      if (ctx.state === "running") {
        events.forEach((ev) => document.removeEventListener(ev, retry));
        return;
      }
      void ctx.resume().catch(() => undefined);
    };
    events.forEach((ev) => document.addEventListener(ev, retry, { passive: true }));
  }

  async loadPack(pack: SoundPack): Promise<void> {
    this.pack = pack;
  }

  /** テーマ再生開始。seed で音の展開を決定的にする。前のテーマが無い最初の1回のみ使う想定。 */
  async begin(theme: ThemeId, seed: number): Promise<void> {
    this.assertReady();

    if (this.currentGraph) {
      // 想定外の呼び出し順（例: Home のフリー再生中に Pomodoro を Start した等）でも
      // 無音を挟まず・古いグラフをリークさせずに済むよう、クロスフェードへ委譲する。
      await this.transitionTo(theme, seed, 3);
      return;
    }

    const graph = await this.buildGraph(theme, seed);
    this.currentGraph = graph;
    this.currentTheme = theme;
    this.lastT = 0;

    const now = this.ctx!.currentTime;
    // stop() 等でマスターゲインが下がったまま残っている可能性があるため、
    // 現在値からのランプで安全に復元する（0起点の等パワーカーブだと段差が出るため使わない）。
    this.masterGain!.gain.cancelScheduledValues(now);
    this.masterGain!.gain.linearRampToValueAtTime(1, now + 0.6);
    // 最初の1回はクロスフェード相手がいないので、短いフェードインのみ。
    graph.scheduleMasterFade(equalPowerCurve(true), now, 1.5);
  }

  /**
   * useTimer から約10Hzで呼ばれる。t は 0.0–1.0。
   * environment は天気/時間帯/経過時間による補正（docs/03_ARCHITECTURE.md ADR-010）。
   * 呼び出し側（apps/web/lib/soundscapeRuntime.ts）が `smoothEnvironment` でなだらかに
   * 近づけた値を渡す想定で、ここでは受け取ってそのまま PhaseGraph に渡すだけ。
   */
  tick(t: number, environment: EnvironmentModifier = NEUTRAL_ENVIRONMENT): void {
    if (!this.ctx || !this.currentGraph) return;
    this.lastT = t;
    this.currentGraph.tick(t, this.ctx.currentTime, environment);
  }

  /** 次テーマへ等パワークロスフェード。無音を挟まない。テーマ変更（例: Study→Work）にも使う。 */
  async transitionTo(next: ThemeId, seed: number, crossfadeSec = DEFAULT_CROSSFADE_SEC): Promise<void> {
    this.assertReady();
    if (!this.currentGraph || !this.currentTheme) {
      await this.begin(next, seed);
      return;
    }

    const newGraph = await this.buildGraph(next, seed);
    const ctx = this.ctx!;
    const now = ctx.currentTime;

    newGraph.scheduleMasterFade(equalPowerCurve(true), now, crossfadeSec);
    this.currentGraph.scheduleMasterFade(equalPowerCurve(false), now, crossfadeSec);

    const outgoing = this.currentGraph;
    this.outgoingGraph?.dispose(); // 前回の後片付けが終わっていなければ念のため即時破棄
    this.outgoingGraph = outgoing;
    this.currentGraph = newGraph;
    this.currentTheme = next;
    this.lastT = 0;

    if (this.disposeOutgoingTimer) clearTimeout(this.disposeOutgoingTimer);
    // 破棄タイミングは音声スケジューリングの精度に影響しないため setTimeout で十分
    // （クロスフェード自体は AudioParam 予約で完結しており、ここは後片付けのみ）。
    this.disposeOutgoingTimer = setTimeout(() => {
      if (this.outgoingGraph === outgoing) {
        outgoing.dispose();
        this.outgoingGraph = null;
        this.releaseBuffersUnusedBy(outgoing, this.currentGraph);
      }
    }, (crossfadeSec + 0.5) * 1000);
  }

  async pause(fadeOutSec = 0.4): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueCurveAtTime(equalPowerCurve(false), now, fadeOutSec);
    if ("suspend" in this.ctx) {
      setTimeout(() => void (this.ctx as AudioContext)?.suspend(), fadeOutSec * 1000);
    }
  }

  async resume(fadeInSec = 0.4): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    if ("resume" in this.ctx) {
      await (this.ctx as AudioContext).resume();
    }
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueCurveAtTime(equalPowerCurve(true), now, fadeInSec);
  }

  async stop(fadeOutSec = 0.4): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueCurveAtTime(equalPowerCurve(false), now, fadeOutSec);

    // グラフの参照はここで即座に手放す。フェード完了を待ってから null にすると、
    // フェード中に begin() が呼ばれたときに「まだ何か鳴っている」と誤認してしまう
    // （begin() は !this.currentGraph でクロスフェード要否を判定するため）。
    const graphsToDispose = [this.currentGraph, this.outgoingGraph].filter(
      (g): g is PhaseGraph => g !== null,
    );
    this.currentGraph = null;
    this.outgoingGraph = null;
    this.currentTheme = null;

    setTimeout(() => {
      for (const g of graphsToDispose) g.dispose();
    }, fadeOutSec * 1000);
  }

  setMasterVolume(v: number): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.linearRampToValueAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime + 0.05);
  }

  setLayerTrim(_role: LayerRole, _v: number): void {
    // Phase 3 (F-22) で実装。現状は SoundscapeEngine インターフェースの形だけ用意する。
  }

  getFrequencyData(out: Uint8Array<ArrayBuffer>): void {
    this.analyser?.getByteFrequencyData(out);
  }

  /**
   * Phase 0 スパイクB/デバッグ用の読み取り専用スナップショット。
   * `nextCellEventTime` が `contextTime` に対して先の時刻を保ち続けていれば、
   * バックグラウンドタブでも先読みスケジューリングが途切れていないことがわかる。
   */
  getDebugInfo(): {
    contextTime: number;
    contextState: string;
    nextCellEventTime: number | null;
    currentTheme: ThemeId | null;
  } | null {
    if (!this.ctx) return null;
    const contextState = "state" in this.ctx ? (this.ctx as AudioContext).state : "offline";
    const nextCellEventTime = this.currentGraph?.cellScheduler.nextEventTime ?? null;

    // apps/web 側は soundscapeRuntime.ts の10Hzループから毎tick呼び、Zustandの
    // `debugInfo` にそのままセットしている。以前は常に新しいオブジェクトを返していたため、
    // 参照比較で「毎回変化した」扱いになり、debugInfo を購読する全ページ・TopNavが
    // 待機中も含めて常時10回/秒再描画されていた。contextTime は音声クロックそのものなので
    // 毎tick変わって当然だが、UI側が実際に参照するのは contextState / currentTheme /
    // nextCellEventTime のみ（contextTime を読む箇所は現状ない）。これらが前回と同じなら
    // 同じオブジェクト参照を返し、無駄な再描画を止める。
    const prev = this.lastDebugInfo;
    if (
      prev &&
      prev.contextState === contextState &&
      prev.currentTheme === this.currentTheme &&
      prev.nextCellEventTime === nextCellEventTime
    ) {
      return prev;
    }

    const next = {
      contextTime: this.ctx.currentTime,
      contextState,
      nextCellEventTime,
      currentTheme: this.currentTheme,
    };
    this.lastDebugInfo = next;
    return next;
  }

  async dispose(): Promise<void> {
    this.ticker?.stop();
    this.ticker = null;
    if (this.disposeOutgoingTimer) clearTimeout(this.disposeOutgoingTimer);
    this.currentGraph?.dispose();
    this.outgoingGraph?.dispose();
    this.currentGraph = null;
    this.outgoingGraph = null;
    this.masterGain?.disconnect();
    this.limiter?.dispose();
    this.analyser?.disconnect();
    if (this.ctx && "close" in this.ctx) {
      await (this.ctx as AudioContext).close();
    }
    this.ctx = null;
    this.bufferLoader?.clear();
    this.lastDebugInfo = null;
  }

  // --- 内部ヘルパ ---

  private assertReady(): void {
    if (!this.ctx || !this.masterGain || !this.bufferLoader) {
      throw new Error("SoundscapeEngine.init() をユーザー操作起点で先に呼んでください。");
    }
    if (!this.pack) {
      throw new Error("SoundscapeEngine.loadPack() を先に呼んでください。");
    }
  }

  private async buildGraph(theme: ThemeId, seed: number): Promise<PhaseGraph> {
    const pack = this.pack!;
    const ctx = this.ctx!;
    const themeDef = pack.themes[theme];
    if (!themeDef) {
      throw new Error(`SoundPack "${pack.id}" has no definition for theme "${theme}".`);
    }
    return PhaseGraph.create({
      ctx,
      bufferLoader: this.bufferLoader!,
      themeDef,
      seed,
      startAt: ctx.currentTime,
      output: this.masterGain!,
    });
  }

  /**
   * クロスフェードで手放した `outgoing` が使っていた音源URLのうち、今なお必要な
   * グラフ（通常はクロスフェード先の新テーマ）が使っていないものだけを BufferLoader
   * から解放する。テーマ間で共有される音源（例: 同じ IR や、雨オーバーレイの遅延ロード
   * URL がたまたま両方のテーマで使われている場合）はここで誤って解放しない。
   */
  private releaseBuffersUnusedBy(outgoing: PhaseGraph, stillActive: PhaseGraph | null): void {
    if (!this.bufferLoader) return;
    for (const url of outgoing.loadedUrls) {
      if (!stillActive?.loadedUrls.has(url)) {
        this.bufferLoader.release(url);
      }
    }
  }

  /** WorkerTicker から呼ばれる。常に SCHEDULE_AHEAD_SEC 先までの Cell 発火を予約しておく。 */
  private serviceCellScheduling(): void {
    if (!this.ctx || !this.currentGraph) return;
    const now = this.ctx.currentTime;
    const graph = this.currentGraph;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nextAt = graph.cellScheduler.nextEventTime;
      if (nextAt >= now + SCHEDULE_AHEAD_SEC) break;
      graph.scheduleCellOneShot(nextAt);
      const density = graph.currentCellDensity(this.lastT);
      graph.cellScheduler.advance(density);
    }
  }
}
