# 04. サウンドスケープ生成エンジン設計（rev.2 / Web Audio API）

**このドキュメントが本プロジェクトの中核です。** タイマーは既製品でも作れますが、
アプリの価値は「25分という時間に対して音の弧を描く」ここに集約されます。

---

## 1. 基本原理

Endel は「サウンドチームが事前にデザインした音素材を、コアロジックがリアルタイムに組み立てる」
構造です（`01_ENDEL_RESEARCH.md` §3）。共同創業者も
「サウンドスケープはステムベースで、膨大なサンプルとステムのライブラリからアルゴリズムが
適切なステムを選んでシーケンスを組み立て、その上にさらに調整を重ねる」と説明しています。

本プロジェクトはその「サウンドチーム」の部分を **AI音楽生成** に置き換えます。

```
  素材ライブラリ（AI生成のループ／ワンショット）
        ├─ Pad     … 和声の土台。長いループ。常に鳴る
        ├─ Texture … 環境音・ノイズ。マスキングと空気感
        ├─ Pulse   … 一定の拍。集中フェーズのみ
        ├─ Cell    … 単音・短い断片。確率的に配置される
        └─ Cue     … フェーズ境界の合図。ワンショット
        ▼
  生成エンジン（packages/audio-engine）
        ├─ PhaseAutomation : 正規化時間 t(0→1) から各層の音量/密度/エフェクト量を決める
        ├─ CellScheduler   : シード付きPRNGで次のCell発火時刻・音程・定位を決める
        ├─ LoopManager     : ループの継ぎ目をクロスフェードで隠し、複数テイクを巡回させる
        ├─ Crossfader      : フェーズ間を等パワーで6秒かけて繋ぐ
        └─ WorkerTicker    : バックグラウンドタブでも止まらない先読みスケジューリング
        ▼
  Web Audio ノードグラフ → destination
```

**「無限に違う音」を生む3つの仕掛け**
1. 各層に複数テイクを用意し、ループの度に別テイクへ渡す（順序はシード依存）
2. Cell 層のワンショットをポアソン過程で確率的に配置（間隔・音程・パン・音量をランダマイズ）
3. 各層のループ長を互いに素に近い値にして、全層の組み合わせの周期を極端に長くする

**破綻させないための制約**
- 全素材は**同一のキーとスケール**にそろえる
- チューニングは **A=440Hz** に統一（Endel と同じ理由: 認知負荷の低減）
- Cell の音程はスケール内の音のみを選ぶ → 何を鳴らしても不協和にならない
- マスターに `DynamicsCompressorNode` を噛ませ、レイヤーが重なってもピークが暴れないようにする

---

## 2. ノードグラフ

```
Pad     BufferSource ─┐
Texture BufferSource ─┤
Pulse   BufferSource ─┼─► GainNode × 4 ─┬─► BiquadFilter ─► Convolver ─┐
Cell    BufferSource ─┘   (層ごとの音量)  │      (LPF)      (Reverb)     │
        + StereoPanner                    └──────── dry ─────────────────┤
                                                                         ▼
                                          AnalyserNode ◄── DynamicsCompressor ──► destination
                                          (ビジュアライザ)     (マスターリミッタ)
```

**リバーブは send/return 構成にする。** Convolver を直列に入れると全部が濡れてしまうので、
`reverbSend` GainNode 経由で Convolver に送り、dry と混ぜます。
`reverbWet` オートメーションはこの send の gain を動かします。

```ts
// 概念コード
const dry = ctx.createGain();
const send = ctx.createGain();
const conv = ctx.createConvolver();
conv.buffer = await loadIR('/ir/hall.wav');

filter.connect(dry);
filter.connect(send);
send.connect(conv);
dry.connect(limiter);
conv.connect(limiter);
limiter.connect(analyser);
analyser.connect(ctx.destination);
```

**リミッタの設定値**（`DynamicsCompressorNode`）:
`threshold: -3`, `knee: 0`, `ratio: 20`, `attack: 0.003`, `release: 0.25`

---

## 3. サウンドパック定義

`apps/web/public/packs.json`:

```jsonc
{
  "packs": [
    {
      "id": "default_warm",
      "name": "Warm",
      "tuning": 440,
      "ir": { "focus": "/ir/room_small.wav", "break": "/ir/hall_large.wav" },
      "focus": {
        "key": "A", "scale": "aeolian", "bpm": 66,
        "layers": [
          { "role": "pad",     "loopSeconds": 32,     "takes": ["/audio/focus/pad_a_01.ogg", "/audio/focus/pad_a_02.ogg", "/audio/focus/pad_a_03.ogg"] },
          { "role": "texture", "loopSeconds": 20,     "mono": true, "takes": ["/audio/focus/pink_air.ogg", "/audio/focus/room_hum.ogg"] },
          { "role": "pulse",   "loopSeconds": 7.2727, "takes": ["/audio/focus/pulse_66_01.ogg", "/audio/focus/pulse_66_02.ogg"] },
          { "role": "cell",    "oneShots": ["/audio/focus/bell_a3.ogg", "/audio/focus/bell_c4.ogg", "/audio/focus/bell_e4.ogg", "/audio/focus/bell_g4.ogg"] }
        ]
      },
      "break": {
        "key": "D", "scale": "lydian", "bpm": null,
        "layers": [
          { "role": "pad",     "loopSeconds": 30, "takes": ["/audio/break/air_d_01.ogg", "/audio/break/air_d_02.ogg"] },
          { "role": "texture", "loopSeconds": 24, "mono": true, "takes": ["/audio/break/rain_leaves.ogg", "/audio/break/waves.ogg"] },
          { "role": "cell",    "oneShots": ["/audio/break/drop_d4.ogg", "/audio/break/drop_f4.ogg", "/audio/break/drop_a4.ogg"] }
        ]
      },
      "cues": { "phaseEnd": "/audio/cues/soft_chime.ogg", "sessionEnd": "/audio/cues/resolve.ogg" }
    }
  ]
}
```

> `pulse` の `loopSeconds` は BPM から算出する。66 BPM で8拍 = 8 × 60/66 = 7.2727秒。
> **ループ長は必ず拍の整数倍にする。** 半端だと拍がずれていく。
> `loopSeconds` は 32秒以下に抑える（メモリ制約、`03_ARCHITECTURE.md` ADR-003）。

---

## 4. フェーズ・オートメーション（音の弧）

Endel の Scenario と同じ「開始 / 中間 / 終了」の3フェーズを、
**正規化時間 `t ∈ [0,1]`** に対するキーフレーム曲線として定義します。
`t` を使うため、25分でも50分でも同じ定義が機能します。

### 4.1 Focus（集中）

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.06 | **Ease-in** | 静かに立ち上がる。パルスは遅れて入る |
| 0.06 – 0.85 | **Sustain** | ほぼ変化しない。ここで音が動くと注意が奪われる |
| 0.85 – 0.95 | **Taper** | Cell の密度を落とし、終わりが近いことを無意識に伝える |
| 0.95 – 1.00 | **Wind-down** | パルスが消え、パッドだけが残る。t=0.98 で cue 音 |

```ts
export const focusAutomation: PhaseAutomation = {
  pad:         [[0.00, 0.00], [0.06, 0.85], [0.85, 0.85], [0.95, 0.70], [1.00, 0.35]],
  texture:     [[0.00, 0.25], [0.10, 0.40], [0.85, 0.40], [1.00, 0.30]],
  pulse:       [[0.00, 0.00], [0.04, 0.00], [0.10, 0.55], [0.85, 0.55], [0.93, 0.30], [0.97, 0.00]],
  cellDensity: [[0.00, 0.02], [0.12, 0.10], [0.80, 0.10], [0.90, 0.04], [1.00, 0.01]], // 毎秒の期待発火数
  reverbWet:   [[0.00, 0.35], [0.10, 0.22], [0.90, 0.22], [1.00, 0.45]],
  lowPassHz:   [[0.00, 1200], [0.08, 6000], [0.88, 6000], [1.00, 2200]],
  breathLfoHz: 0,
  breathDepth: 0,
};
```

**設計根拠**（`01_ENDEL_RESEARCH.md` §4）
- Endel は「一定のビートが長時間の集中を助ける」ことを生産性サウンドの基礎に据えている
  → `pulse` を Sustain 区間で完全に一定に保つ
- 「刺激的だが決して気を散らさない」→ Sustain 中の変化は ±2dB 以内。メロディックな展開を作らない
- Cell の密度も低く（毎秒0.1 = 約10秒に1回）保つ。これは「何かが動いている」という最小限の
  生気を与えるためであり、音楽的なフレーズを作るためではない

### 4.2 Break（休憩）

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.10 | **Release** | 緊張を解く。リバーブが一気に広がり、パルスは消えている |
| 0.10 – 0.80 | **Rest** | 自然音が主役。密度は最小。ゆるやかな呼吸 |
| 0.80 – 1.00 | **Re-engage** | わずかに明るさを戻し、次の集中への助走をつける。t=0.98 で cue 音 |

```ts
export const breakAutomation: PhaseAutomation = {
  pad:         [[0.00, 0.55], [0.12, 0.90], [0.80, 0.90], [1.00, 0.45]],
  texture:     [[0.00, 0.35], [0.15, 0.75], [0.80, 0.75], [1.00, 0.45]],
  pulse:       [[0.00, 0.00], [0.90, 0.00], [1.00, 0.18]],  // 終盤にだけ僅かに戻す
  cellDensity: [[0.00, 0.06], [0.20, 0.03], [0.85, 0.03], [1.00, 0.05]],
  reverbWet:   [[0.00, 0.45], [0.15, 0.65], [0.85, 0.65], [1.00, 0.40]],
  lowPassHz:   [[0.00, 3000], [0.15, 1800], [0.85, 1800], [1.00, 3500]],
  breathLfoHz: 0.08,   // 音量をゆっくり呼吸させる
  breathDepth: 0.12,
};
```

**設計根拠**: Endel の Relax は「脳が処理しやすい単純な音構造」と「自然音」を使い、
副交感神経の活性化を狙う → texture を主役にし、pad は背景に回す。
拍を消すのは意図的で、休憩に拍があると身体が作業モードを維持してしまう。

### 4.3 対照表（実装時のチェックリスト）

| 要素 | Focus | Break |
|---|---|---|
| 拍 | あり（60–72 BPM、一定） | なし（終盤のみ僅かに） |
| スケール | Aeolian / Dorian（落ち着き） | Lydian / Major pentatonic（開放感） |
| リバーブ | 小さめの部屋のIR、wet 0.20–0.35 | 大きなホールのIR、wet 0.40–0.70 |
| ローパス | 6kHz 前後 | 1.8kHz 前後 |
| Texture | ピンクノイズ・空調のような無機質な音 | 雨・波・鳥といった自然音 |
| Cell 発火頻度 | 約10秒に1回 | 約30秒に1回 |
| 音量ダイナミクス | ほぼ一定（±2dB） | 呼吸するように（±4dB, 0.08Hz） |
| 定位 | 中央寄り、安定 | 広く、ゆっくり移動 |

---

## 5. 主要インターフェース

```ts
export type LayerRole = 'pad' | 'texture' | 'pulse' | 'cell' | 'cue';
export type SessionPhase = 'focus' | 'shortBreak' | 'longBreak';

/** キーフレーム列。t は 0.0–1.0 の昇順。線形補間。 */
export type Keyframes = ReadonlyArray<readonly [t: number, value: number]>;

export interface PhaseAutomation {
  readonly pad: Keyframes;
  readonly texture: Keyframes;
  readonly pulse: Keyframes;
  readonly cellDensity: Keyframes;
  readonly reverbWet: Keyframes;
  readonly lowPassHz: Keyframes;
  readonly breathLfoHz: number;
  readonly breathDepth: number;
}

/** 純粋関数。ユニットテストの主対象。 */
export function valueAt(kf: Keyframes, t: number): number;

export interface SoundscapeEngine {
  /** ユーザー操作（Startボタン）を起点にのみ呼ぶこと。自動再生ポリシー対策。 */
  init(): Promise<void>;
  loadPack(pack: SoundPack): Promise<void>;

  /** フェーズ開始。seed で音の展開を決定的にする。 */
  begin(phase: SessionPhase, seed: number): Promise<void>;

  /** useTimer から約10Hzで呼ばれる。t は 0.0–1.0。 */
  tick(t: number): void;

  /** 次フェーズへ等パワークロスフェード。無音を挟まない。 */
  transitionTo(next: SessionPhase, seed: number, crossfadeSec?: number): Promise<void>;

  pause(fadeOutSec?: number): Promise<void>;
  resume(fadeInSec?: number): Promise<void>;
  stop(fadeOutSec?: number): Promise<void>;

  setMasterVolume(v: number): void;
  setLayerTrim(role: LayerRole, v: number): void;   // ユーザー設定によるオフセット
  getFrequencyData(out: Uint8Array): void;          // AnalyserNode から
  dispose(): Promise<void>;
}
```

---

## 6. 実装の要所

### 6.1 WorkerTicker — バックグラウンドタブ対策（**最重要**）

タブが非表示になると `setTimeout` は毎秒1回以下に絞られます。25分セッション中に
ユーザーが別タブへ移るのは当然の使い方なので、これは必須の対策です。

```ts
// packages/audio-engine/src/scheduler.worker.ts
setInterval(() => self.postMessage('tick'), 25);
```

```ts
// engine 側。時刻の基準は必ず ctx.currentTime。Date.now() でも performance.now() でもない。
const SCHEDULE_AHEAD_SEC = 2.0;   // これだけ先まで予約しておけばスロットリングされても途切れない

worker.onmessage = () => {
  const now = ctx.currentTime;
  while (this.nextCellTime < now + SCHEDULE_AHEAD_SEC) {
    this.scheduleCell(this.nextCellTime);
    this.nextCellTime += this.nextIntervalFromPoisson();
  }
  this.applyAutomationUpTo(now + SCHEDULE_AHEAD_SEC);
};
```

`AudioContext` 自体は音が鳴っている限りスロットリングされません。
**先に予約さえ済ませておけば、タブが裏でも音は完璧に鳴り続けます。**

### 6.2 ギャップレスループ

Web Audio の `AudioBufferSourceNode` はサンプル精度でループします。
ネイティブの音楽プレイヤーより正確です。

```ts
const src = ctx.createBufferSource();
src.buffer = buffer;
src.loop = true;
src.loopStart = 0;
src.loopEnd = loopSeconds;
src.playbackRate.value = 1 + (rng() - 0.5) * 0.006;  // ±0.3% の微小デチューン
src.connect(layerGain);
src.start(startTime);
```

### 6.3 LoopManager — ループの継ぎ目を隠す

同一素材を繰り返すと、人は数回で「ループだ」と気づきます。これを防ぐため:

1. **クロスフェード・ループ**: ループ末尾 1.5〜3秒を、次テイクの先頭に等パワーで重ねる
2. **テイクのローテーション**: 3テイク以上を用意し、シード順に巡回。同じテイクが連続しない
3. **周期のずらし**: pad(32秒) / texture(20秒) / pulse(7.27秒) のように**互いに素に近い長さ**にする
4. **微小デチューン**: `playbackRate` を ±0.3% の範囲でテイクごとに変える

### 6.4 等パワークロスフェード

**線形フェードは使わないこと。** 中間で音圧が落ち込んで「谷」ができます。

```ts
function equalPowerCurve(fadeIn: boolean, steps = 128): Float32Array {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);
    curve[i] = fadeIn ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }
  return curve;
}

outgoing.gain.setValueCurveAtTime(equalPowerCurve(false), ctx.currentTime, 6);
incoming.gain.setValueCurveAtTime(equalPowerCurve(true),  ctx.currentTime, 6);
```

> `setValueCurveAtTime` は、実行中に同じ AudioParam へ他の予約を入れると例外を投げます。
> クロスフェード中はその層のオートメーションを止めること。

移行の開始は「Focus の t=1.0 到達時」ではなく **t≈0.985 から**。
タイマーの切替より音が先に動くことで自然になります。

### 6.5 CellScheduler — 確率的ワンショット配置

```ts
export class CellScheduler {
  private nextAt: number;
  constructor(
    private rng: () => number,          // seedrandom 等の決定的PRNG
    private scaleSemitones: number[],   // Aeolian: [0,2,3,5,7,8,10]
    startTime: number,
  ) {
    this.nextAt = startTime + 5;        // 開始直後の発火は唐突なので5秒オフセット
  }

  /** density は「毎秒の期待発火数」。ポアソン過程 = 間隔が指数分布。 */
  nextInterval(density: number): number {
    return -Math.log(1 - this.rng()) / density;
  }

  pick(): CellEvent {
    const st = this.scaleSemitones[Math.floor(this.rng() * this.scaleSemitones.length)];
    return {
      semitone: st + (this.rng() < 0.5 ? 0 : 12),
      pan: (this.rng() * 2 - 1) * 0.6,
      gain: 0.5 + this.rng() * 0.35,
    };
  }
}
```

音程変更は `playbackRate = 2 ** (semitone / 12)` で行います（再生速度も変わりますが、
短い減衰音なので気になりません。気になるなら素材を音程ごとに用意してください）。

### 6.6 メモリ管理

`decodeAudioData` の結果は非圧縮 Float32。**60秒ステレオ44.1kHz ≈ 21MB**。

- ループは 32秒以下
- Texture 層は `mono: true`（半分になる）
- Pad 以外は 22.05kHz で書き出しても聴感上の差は小さい
- 使わないフェーズのバッファはクロスフェード完了後に解放する
- **Phase 0 で実測してから素材長を確定すること**

---

## 7. 音素材の作り方（AI生成ワークフロー）

### 7.1 手順
1. AI音楽サービスで下記プロンプト例を使って各層の素材を生成
2. DAW（Reaper / Audacity など）で:
   - キーを揃える（必要ならピッチ補正）
   - ループ長を拍の整数倍にトリミング
   - 先頭・末尾の DC オフセットとクリックを除去
   - ラウドネスを **−20 LUFS 前後**に統一（層を重ねる前提なので個々は小さめに）
3. **OGG Vorbis（q6）** で書き出し、`apps/web/public/audio/` 配下へ
4. `packs.json` に登録
5. ライセンス情報を `docs/ASSET_LICENSES.md` に記録

> MP3 はエンコーダのパディングでループにギャップが入るため使わないこと。
> ただし Web Audio は `decodeAudioData` で展開してから `loopEnd` を指定するので、
> **OGG なら実質問題は起きません。**

### 7.2 プロンプト例

**Focus / Pad**
> minimal ambient pad, sustained warm analog synthesizer, A minor drone, slow evolving texture, no melody, no percussion, no vocals, calm and unobtrusive, seamless loop, 32 seconds

**Focus / Pulse**
> soft minimal electronic pulse, 66 BPM, muted kick and closed hi-hat only, very low intensity, no melody, no bass line, steady and hypnotic, seamless loop

**Focus / Texture**
> subtle pink noise bed with faint room tone, no music, no melody, constant level, seamless loop

**Focus / Cell（ワンショット）**
> single soft bell tone, A3, gentle mallet attack, long natural decay, isolated single note

**Break / Pad**
> spacious ambient pad, D lydian, airy and bright, wide stereo, very slow movement, no percussion, no melody, seamless loop, 30 seconds

**Break / Texture**
> gentle rain on leaves with distant birds, natural field recording style, no music, calm, seamless loop

**Cue**
> single soft chime, warm and clear, gentle attack, medium decay, isolated

### 7.3 インパルス応答（リバーブ）

`ConvolverNode` に実測IRを食わせられるのは Web の隠れた強みです。
アルゴリズミックリバーブと違い、本物の空間の残響がそのまま使えます。

- Focus には**小さめの部屋**のIR（近く、明瞭）
- Break には**大きなホール**や教会のIR（遠く、広い）
- OpenAIR などの公開IRライブラリが利用できるが、**ライセンスを必ず確認**して
  `ASSET_LICENSES.md` に記録すること
- IR はモノラルでも十分。長さ2〜4秒程度で足りる

### 7.4 やってはいけないこと
- 特定のアーティスト名・既存曲名をプロンプトに含めない（ブロックされるうえ権利リスクがある）
- ボーカル入りの素材を使わない（言語処理を誘発し集中を妨げる）
- 目立つメロディやコード進行を持つ素材を使わない（Focus では特に致命的）

---

## 8. テスト方針

`OfflineAudioContext` があるので、**音の一部はCIで自動検証できます。**

| 対象 | 方法 |
|---|---|
| `valueAt` | 純粋関数の単体テスト。境界（t=0, 1）とキーフレーム間の補間値 |
| `CellScheduler` | 同一シードで同一系列が出ること、密度を上げると発火数が期待通り増えることを統計的に検証 |
| ループ長 | 全 pulse 素材について `loopSeconds × bpm / 60` が整数であることをテストで保証 |
| **クロスフェード** | `OfflineAudioContext` で移行区間をレンダリングし、**RMS が ±1.5dB 以内**に収まることを検証。谷ができていれば失敗 |
| **クリッピング** | レンダリング結果に \|sample\| > 1.0 のサンプルが無いことを検証 |
| WorkerTicker | フェイクタイマーで、2秒先までのイベントが常に予約済みであることを検証 |
| 実ブラウザ | 25分・50分の通し再生を Chrome / Safari / Firefox で。**タブを裏にして放置するテストを必ず行う** |
| 実聴 | 有線ヘッドホン / Bluetooth / ノートPCスピーカーの3系統で耳で確認する。**自動テストでは代替できない** |

---

## 9. 将来: ネイティブへの移植

`packages/audio-engine` を素の Web Audio API に対して書いておく最大の理由がこれです。

`react-native-audio-api`（Software Mansion）は Web Audio 仕様に準拠しており、
`AudioBufferSourceNode` / `GainNode` / `BiquadFilterNode` / `ConvolverNode` /
`StereoPannerNode` / `AnalyserNode` / `OfflineAudioContext` がすべて実装済みです。
`apps/mobile`（Expo）を足して `import` 先を差し替えるだけで、エンジンはほぼそのまま動きます。

**移植時に必要な差分は2点だけ**:
1. `DynamicsCompressorNode` が未実装 → `WaveShaperNode` のソフトクリップ曲線で代替する。
   このため**リミッタは最初からインターフェースで抽象化しておくこと**
2. Web Worker → `react-native-worklets` ベースのティッカーに差し替え
