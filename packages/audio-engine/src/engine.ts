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
/** `AudioContext.resume()` の待機を打ち切るまでの時間（`ensureRunning` 参照）。 */
const RESUME_TIMEOUT_MS = 1500;
/**
 * 通知音を短く切り上げるときのリリース長を、1音の長さに対する比で決める。
 *
 * 固定の極短いリリースだとベルの余韻をぶつ切りにしてしまい、素材が本来持つ響きが死ぬ。
 * 後半をなだらかに減衰させることで、切り上げつつも「鳴り終わった」と聞こえるようにする。
 */
const CUE_BEEP_RELEASE_RATIO = 0.45;
/** ごく短い1音でもクリックノイズが出ないようにするリリースの下限。 */
const CUE_BEEP_MIN_RELEASE_SEC = 0.02;

/**
 * 通知音の鳴らし方。「`beeps` 個の連打（バースト）を `bursts` 回くり返す」という形で表す。
 * 単発なら既定値のままでよい。
 */
export interface CuePattern {
  gain?: number;
  /** 1バースト内の音数。「ピピピピッ」なら4。 */
  beeps?: number;
  /** バースト内の音の間隔（秒）。連打として聞こえる程度に短くする。 */
  beepIntervalSec?: number;
  /** バーストのくり返し回数。 */
  bursts?: number;
  /** バーストの先頭同士の間隔（秒）。 */
  burstIntervalSec?: number;
  /** 1音の長さ（秒）。省略すると素材を最後まで鳴らす。指定すると短い「ピッ」になる。 */
  beepSec?: number;
}

/**
 * `CuePattern` を鳴らし切るのにかかる秒数。
 * 呼び出し側が「アラームが終わるまで別の音を戻さない」といった判断に使えるよう、
 * パターンの定義と同じ場所に置いてズレないようにする。
 * `beepSec` 省略時は素材の長さが分からないので、最後の1音の長さは 0 として扱う
 * （＝最後の音の鳴り始めまでの時間を返す）。
 */
export function cuePatternDurationSec(pattern: CuePattern): number {
  const { beeps = 1, beepIntervalSec = 0.17, bursts = 1, burstIntervalSec = 1.3, beepSec = 0 } = pattern;
  const lastBurstStart = (Math.max(1, bursts) - 1) * burstIntervalSec;
  const lastBeepStart = (Math.max(1, beeps) - 1) * beepIntervalSec;
  return lastBurstStart + lastBeepStart + beepSec;
}
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
  /**
   * フェード専用のバス。begin/pause/resume/stop の等パワーカーブは**このノードだけ**を動かす。
   * ユーザー音量は下流の volumeGain が持つ（両者を1つの AudioParam に相乗りさせると、
   * 絶対値カーブであるフェードがユーザー音量を上書きしてしまう。docs/04_SOUND_ENGINE.md §2）。
   */
  private masterGain: GainNode | null = null;
  /** ユーザーが音量バーで決める音量。フェードとは独立した AudioParam でなければならない。 */
  private volumeGain: GainNode | null = null;
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
  /**
   * `pause()` がフェードアウト完了後に予約する `suspend()` のハンドル。
   * フェード中に `resume()`／再生要求が来たら必ず取り消すこと。取り消さないと、再開した直後に
   * 遅れて suspend が発火して「ゲインは戻っているのに無音」という復帰不能な状態になる。
   */
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  /** ユーザー音量の現在値。init() 前に setMasterVolume() されても失われないよう保持する。 */
  private masterVolume = 1;
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

    await this.ensureRunning();

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;
    this.volumeGain = ctx.createGain();
    this.volumeGain.gain.value = this.masterVolume;
    this.limiter = createCompressorLimiter(ctx);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;

    // フェード（masterGain）→ ユーザー音量（volumeGain）→ リミッタ → 解析 → 出力。
    // 音量をリミッタより前に置くことで、絞ったときに不要な圧縮がかからない。
    this.masterGain.connect(this.volumeGain);
    this.volumeGain.connect(this.limiter.inputNode);
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
   * 「これから音を鳴らす」すべての入口で呼ぶ、AudioContext を running に揃えるための唯一のゲート。
   *
   * 自動再生ポリシーで suspended に落ちた context は、`begin()`/`transitionTo()` を呼んでも
   * 自動的には戻らない。以前はここを通していなかったため、フェードもグラフ構築も成功した
   * ように見えて実際には無音（UI は再生中の表示のまま）になる経路が残っていた。
   *
   * `pause()` が予約した `suspend()` もここで取り消す。取り消さないと、再開した直後に
   * 遅れて suspend が発火して復帰不能になる。
   *
   * resume() が長時間 pending のまま解決しないブラウザがあるため、待機には見切り時間を設ける
   * （呼び出し側を無期限に止めない。resume 自体は裏で解決を試み続ける）。
   */
  private async ensureRunning(): Promise<void> {
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
    const ctx = this.ctx;
    if (!ctx || !("resume" in ctx)) return;
    const audioCtx = ctx as AudioContext;
    // `state` は await をまたいで変化するライブな値なので、そのつど読み直す。
    // プロパティを直接比較すると TypeScript が最初の判定で型を絞り込んでしまい、
    // 後段の「まだ running でないか」の再確認が到達不能とみなされてしまう。
    const readState = (): AudioContextState => audioCtx.state;
    if (readState() === "running") return;

    // resume() が先に解決しても見切り用タイマーは残り続けるので、必ず後始末する
    // （放置すると 1.5秒間プロセス/タブにタイマーが積み上がる）。
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        audioCtx.resume().catch(() => undefined),
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, RESUME_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }

    // まだ suspended のままなら、このページ上での次の実操作で確実に再開させる保険を張る。
    // Chrome は自動再生ポリシー上この再開をブラウザ側で行うことがあるが、Firefox/Safari 等は
    // resume() 呼び出し自体がジェスチャーのコールスタック内にあることを要求するため、
    // アプリ側でも明示的に listener を張っておく。
    if (readState() !== "running") {
      this.armGestureUnlock(audioCtx);
    }
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
    await this.ensureRunning();

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
    // stop()/pause() でフェードバスが下がったまま残っている可能性があるため、現在値からの
    // ランプで安全に復元する（0起点の等パワーカーブだと段差が出るため使わない）。
    // ここで動かすのはフェードバスだけであり、ユーザー音量（volumeGain）には触れない。
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
    await this.ensureRunning();
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
      // ハンドルを保持しておき、フェード中に resume()/再生要求が来たら ensureRunning() が取り消す。
      if (this.suspendTimer) clearTimeout(this.suspendTimer);
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        void (this.ctx as AudioContext)?.suspend();
      }, fadeOutSec * 1000);
    }
  }

  async resume(fadeInSec = 0.4): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    await this.ensureRunning();
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueCurveAtTime(equalPowerCurve(true), now, fadeInSec);
  }

  async stop(fadeOutSec = 0.4): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
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

  /**
   * ユーザー音量。フェード用の masterGain とは別ノードなので、フェードの実行中に呼んでも
   * 予約が競合せず（Web Audio 仕様では setValueCurveAtTime 実行中の同一 AudioParam への
   * 予約は例外になる）、フェードがユーザー音量を上書きすることもない。
   */
  setMasterVolume(v: number): void {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (!this.ctx || !this.volumeGain) return; // init() 前でも値は保持し、init() 時に反映する
    this.volumeGain.gain.linearRampToValueAtTime(this.masterVolume, this.ctx.currentTime + 0.05);
  }

  /**
   * フェーズ/セッションの終了を知らせるワンショット（`SoundPack.cues`）を鳴らす。
   *
   * **テーマのフェードバス（masterGain）は経由せず、ユーザー音量（volumeGain）へ直結する。**
   * 終了と同時にテーマをフェードアウト・停止させる画面があるため、フェードバスに乗せると
   * 肝心の通知音まで一緒に消えてしまう。通知は「鳴っている音の状態によらず必ず届く」ことが
   * 役割なので、音量設定にだけ従わせる。
   *
   * 鳴らし方は「バースト（`beeps` 個の連打）を `bursts` 回くり返す」という形で指定する。
   * 単発で鳴らしたいときは既定値（どちらも1）のままでよい。
   *
   * `beepSec` を指定すると1音をその長さで切り上げる。Cell 層で鳴っている環境音のベルと
   * 同じ素材でも、短く刻めば「ピピピピッ」というアラームとして明確に区別できるようになる
   * （素材の長い余韻をそのまま重ねると連打が滲んで、ただのベルの連続に聞こえてしまう）。
   *
   * すべてサンプル精度でまとめて予約するので、メインスレッドが詰まってもリズムは崩れない。
   */
  async playCue(kind: keyof SoundPack["cues"], opts: CuePattern = {}): Promise<void> {
    const {
      gain = 0.9,
      beeps = 1,
      beepIntervalSec = 0.17,
      bursts = 1,
      burstIntervalSec = 1.3,
      beepSec,
    } = opts;
    if (!this.ctx || !this.volumeGain || !this.bufferLoader || !this.pack) return;
    await this.ensureRunning();
    const url = this.pack.cues[kind];
    if (!url) return;
    const buffer = await this.bufferLoader.load(url);
    // ロード待ちの間に dispose された可能性があるため、使う直前に取り直す
    const ctx = this.ctx;
    const destination = this.volumeGain;
    if (!ctx || !destination) return;

    const level = Math.max(0, Math.min(1, gain));
    const startAt = ctx.currentTime;
    for (let burst = 0; burst < Math.max(1, bursts); burst++) {
      for (let beep = 0; beep < Math.max(1, beeps); beep++) {
        const at = startAt + burst * burstIntervalSec + beep * beepIntervalSec;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const cueGain = ctx.createGain();
        cueGain.gain.value = level;
        source.connect(cueGain).connect(destination);
        source.start(at);

        if (beepSec !== undefined) {
          // 後半をなだらかに減衰させてから切る。素材（ベル）の余韻を残しつつ、
          // 次の音が鳴る前に確実に鳴り止ませるための窓。
          const release = Math.max(CUE_BEEP_MIN_RELEASE_SEC, beepSec * CUE_BEEP_RELEASE_RATIO);
          const sustainUntil = Math.max(at, at + beepSec - release);
          cueGain.gain.setValueAtTime(level, at);
          cueGain.gain.setValueAtTime(level, sustainUntil);
          cueGain.gain.linearRampToValueAtTime(0, at + beepSec);
          source.stop(at + beepSec);
        }

        source.onended = () => {
          source.disconnect();
          cueGain.disconnect();
        };
      }
    }
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
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    this.currentGraph?.dispose();
    this.outgoingGraph?.dispose();
    this.currentGraph = null;
    this.outgoingGraph = null;
    this.masterGain?.disconnect();
    this.volumeGain?.disconnect();
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
