# 04. サウンドスケープ生成エンジン設計（rev.3 / Web Audio API）

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

rev.3（`03_ARCHITECTURE.md` ADR-004）から、音響定義の単位は「フェーズ(focus/break)」ではなく
「**テーマ**」になった。テーマは Home / Pomodoro の UI に並ぶ5つ
（`study` / `work` / `move` / `relax` / `sleep`）と1:1で対応し、各テーマが
key / scale / bpm / layers に加えて**自分専用の `PhaseAutomation` を内包する**
（データ駆動。コード側にフェーズ別の automation をハードコードしない）。

`study` / `work` / `move` は Pomodoro の Focus フェーズで、`relax` / `sleep` は
Break フェーズ（`shortBreak` → relax、`longBreak` → sleep）で使う
（`ThemeSoundDefinition.kind` で区別。クロスフェード可否には影響しない — テーマ間の
切り替えは常にクロスフェードする）。

`apps/web/public/packs.json`（1テーマ分を抜粋。全5テーマの値は §4 の表と
`packages/audio-engine/src/automation.ts` を参照）:

```jsonc
{
  "packs": [
    {
      "id": "default",
      "name": "Kairos",
      "tuning": 440,
      "themes": {
        "study": {
          "kind": "focus",
          "key": "A", "scale": "aeolian", "bpm": 68,
          "ir": "/ir/room_small.wav",
          "layers": [
            { "role": "pad",     "loopSeconds": 32,        "takes": ["/audio/study/pad_01.wav", "/audio/study/pad_02.wav", "/audio/study/pad_03.wav"] },
            { "role": "texture", "loopSeconds": 20, "mono": true, "takes": ["/audio/study/texture_pink_a.wav", "/audio/study/texture_pink_b.wav"] },
            { "role": "pulse",   "loopSeconds": 7.05882353, "takes": ["/audio/study/pulse_01.wav", "/audio/study/pulse_02.wav"] },
            { "role": "cell",    "oneShots": ["/audio/study/cell_a3.wav", "/audio/study/cell_c4.wav", "/audio/study/cell_e4.wav", "/audio/study/cell_g4.wav"] }
          ],
          "automation": { "pad": [ /* keyframes */ ], "texture": [], "pulse": [], "cellDensity": [], "reverbWet": [], "lowPassHz": [], "breathLfoHz": 0, "breathDepth": 0 }
        }
        // work / move / relax / sleep も同じ形。§4 の表 + automation.ts が正。
      },
      "cues": { "phaseEnd": "/audio/cues/soft_chime.wav", "sessionEnd": "/audio/cues/resolve.wav" }
    }
  ]
}
```

> `pulse` の `loopSeconds` は BPM から算出する。68 BPM で8拍 = 8 × 60/68 = 7.05882353秒。
> **ループ長は必ず拍の整数倍にする。** 半端だと拍がずれていく。
> `packages/audio-engine/src/pulse-loop.ts` の `isPulseLoopAligned` がこれをテストで保証する
> （`packs.test.ts` が `packs.json` の全テーマを実際に検証する）。
> `loopSeconds` は 32秒以下に抑える（メモリ制約、`03_ARCHITECTURE.md` ADR-003）。

---

## 4. テーマ別オートメーション（音の弧）

Endel の Scenario と同じ「開始 / 中間 / 終了」の弧を、
**正規化時間 `t ∈ [0,1]`** に対するキーフレーム曲線として定義します。
`t` を使うため、25分でも50分でも同じ定義が機能します。

rev.3（`03_ARCHITECTURE.md` ADR-004）から、この弧は5つのテーマ（study/work/move/relax/sleep）
それぞれが個別に持ちます。実装は `packages/audio-engine/src/automation.ts`
（`studyAutomation` などのエクスポート）が正で、下表はその設計根拠の要約です。
根拠文献は `docs/deep-research-report_chatGPT.md`（ChatGPT報告）と
`集中力を高める音の文献調査_gemini.md`（Gemini報告）。

### 4.1 Focus 系テーマ（Study / Work / Move）— 区間構造は共通

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.06 | **Ease-in** | 静かに立ち上がる。パルスは遅れて入る（Move だけ短め・速め） |
| 0.06 – 0.85 | **Sustain** | ほぼ変化しない。ここで音が動くと注意が奪われる |
| 0.85 – 0.95 | **Taper** | Cell の密度を落とし、終わりが近いことを無意識に伝える |
| 0.95 – 1.00 | **Wind-down** | パルスが消え、パッドだけが残る。t=0.98 で cue 音 |

| 項目 | **Study** | **Work** | **Move** |
|---|---|---|---|
| Key / Scale | A Aeolian | A Dorian | E Major Pentatonic |
| BPM | 68（安静時心拍に近い一定リズム） | 76（Studyよりやや速く覚醒度を上げる） | 112（運動的・明るいテンポ） |
| Texture | ピンクノイズのみ（純粋なマスキング） | ピンクノイズ＋ハムのブレンド（「オフィス」の質感） | 高域寄りの軽いエア質感（マスキングより開放感） |
| Pulse (Sustain) | 0.42（控えめ、一定） | 0.52（やや前に出る） | 0.68（強く推進力を出す） |
| Cell 発火頻度 | 約11秒に1回 | 約7.7秒に1回 | 約4.5秒に1回（生気） |
| Reverb (Sustain) | 0.20（小部屋、明瞭） | 0.16（タイトでドライ） | 0.10（さらにドライ、パンチを殺さない） |
| Low-pass (Sustain) | 6000Hz | 7200Hz | 9500Hz（明るく開放的） |
| 根拠 | ChatGPT報告「作業タイプ依存性」表: 集中学習は一定テンポ・歌詞なし・ピンクノイズ・音量中 | Gemini報告 §3.2: 単純作業はやや速いテンポで交感神経を軽く刺激 | 両報告: 明るいテンポの音楽が気分と覚醒度を高める（100–140BPM） |

**設計根拠（共通）**（`01_ENDEL_RESEARCH.md` §4 と ChatGPT/Gemini報告の合意点）
- 「一定のビートが長時間の集中を助ける」→ `pulse` を Sustain 区間で完全に一定に保つ
- 「刺激的だが決して気を散らさない」→ Sustain 中の変化は無し。メロディックな展開を作らない
- Cell はスケール内の音だけを選ぶ（`CellScheduler`）ので、密度をどれだけ上げても不協和にならない
- 歌詞・言語情報のある音は一切使わない（無関連発話効果 / ISE、Gemini報告 §3.1）

### 4.2 Break 系テーマ（Relax / Sleep）— 区間構造は共通

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.12 / 0.15 | **Release** | 緊張を解く。リバーブが一気に広がり、パルスは無い |
| 0.12 – 0.80 | **Rest** | 自然音・ノイズ色が主役。密度は最小。ゆるやかな呼吸 |
| 0.80 – 1.00 | **Re-engage** | わずかに明るさを戻す。t=0.98 で cue 音 |

| 項目 | **Relax**（shortBreak） | **Sleep**（longBreak） |
|---|---|---|
| Key / Scale | D Lydian（開放感） | D Aeolian・低い register（深さ） |
| Texture | 雨・葉音／波（自然音、ソフトファシネーション） | ブラウンノイズ（過覚醒の鎮静、Gemini報告 §1.1） |
| Reverb (Rest) | 0.65（大きなホール） | 0.75（さらに大きく暗い） |
| Low-pass (Rest) | 1800Hz | 1000Hz（さらに暗く、高域刺激を避ける） |
| 呼吸 LFO | 0.08Hz / depth 0.12（約12.5秒周期） | 0.045Hz / depth 0.16（約22秒周期、よりゆっくり） |
| Pulse | 無し | 無し |

**設計根拠**: 自然音はストレスを軽減しソフトファシネーションを提供する（両報告）→ texture を
主役にし、pad は背景に回す。拍を消すのは意図的で、休憩に拍があると身体が作業モードを
維持してしまう。Sleep は Relax よりさらに低いローパス・大きなリバーブ・遅い呼吸にして
覚醒度を最小まで落とす。

### 4.3 対照表（実装時のチェックリスト）

| 要素 | Study | Work | Move | Relax | Sleep |
|---|---|---|---|---|---|
| 拍 | あり・一定 68bpm | あり・一定 76bpm | あり・一定 112bpm | なし | なし |
| Noise color | ピンク | ピンク＋ハム | 軽いエア（ハイパス強め） | 自然音（雨/波） | ブラウン |
| Reverb | 小部屋 0.20–0.28 | 小部屋 0.16–0.22 | ドライ 0.10–0.14 | ホール 0.45–0.65 | 深ホール 0.55–0.75 |
| Low-pass | 6000Hz | 7200Hz | 9500Hz | 1800–3000Hz | 1000–1600Hz |
| Cell 発火頻度 | 約11秒に1回 | 約7.7秒に1回 | 約4.5秒に1回 | 約20–30秒に1回 | 約50秒に1回 |
| 呼吸 | 無し | 無し | 無し | 0.08Hz | 0.045Hz |
| Pomodoro での役割 | Focus（選択可） | Focus（選択可・既定） | Focus（選択可） | shortBreak（固定） | longBreak（固定） |

---

## 5. 主要インターフェース

```ts
export type LayerRole = 'pad' | 'texture' | 'pulse' | 'cell' | 'cue';

/** UI の5テーマと1:1対応する識別子。SoundPack.themes のキーになる。 */
export type ThemeId = 'study' | 'work' | 'move' | 'relax' | 'sleep';

/** テーマがタイマーのどちらのフェーズに属するか（Focus 系 or Break 系）。 */
export type ThemeKind = 'focus' | 'break';

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

/** 1テーマ分の音響定義。automation を内包するので、テーマごとに完全に独立して設計できる。 */
export interface ThemeSoundDefinition {
  readonly kind: ThemeKind;
  readonly key: string;
  readonly scale: string;
  readonly bpm: number | null;
  readonly ir: string;
  readonly layers: readonly LayerSpec[];
  readonly automation: PhaseAutomation;
}

export interface SoundPack {
  readonly id: string;
  readonly name: string;
  readonly tuning: number;
  readonly themes: Readonly<Record<ThemeId, ThemeSoundDefinition>>;
  readonly cues: { readonly phaseEnd: string; readonly sessionEnd: string };
}

export interface SoundscapeEngine {
  /** ユーザー操作（Startボタン）を起点にのみ呼ぶこと。自動再生ポリシー対策。 */
  init(): Promise<void>;
  loadPack(pack: SoundPack): Promise<void>;

  /** テーマ再生開始。seed で音の展開を決定的にする。 */
  begin(theme: ThemeId, seed: number): Promise<void>;

  /** useTimer から約10Hzで呼ばれる。t は 0.0–1.0。 */
  tick(t: number): void;

  /** 次テーマへ等パワークロスフェード。無音を挟まない（フェーズ遷移にもテーマ変更にも使う）。 */
  transitionTo(next: ThemeId, seed: number, crossfadeSec?: number): Promise<void>;

  pause(fadeOutSec?: number): Promise<void>;
  resume(fadeInSec?: number): Promise<void>;
  stop(fadeOutSec?: number): Promise<void>;

  setMasterVolume(v: number): void;
  setLayerTrim(role: LayerRole, v: number): void;   // ユーザー設定によるオフセット
  getFrequencyData(out: Uint8Array): void;          // AnalyserNode から
  dispose(): Promise<void>;
}
```

> どのタイマーフェーズでどのテーマを鳴らすかは audio-engine の関知するところではない。
> `apps/web/lib/soundscapeRuntime.ts` の `themeIdForTimerPhase()` が
> `(タイマーの phase, 選択中の focusThemeId) → ThemeId` の対応を1箇所で決める
> （focus → 選択中のテーマ、shortBreak → relax 固定、longBreak → sleep 固定）。

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
3. **OGG Vorbis（q6）** で書き出し、`apps/web/public/audio/<themeId>/` 配下へ
   （例: `apps/web/public/audio/study/pad_01.ogg`。テーマIDは `study`/`work`/`move`/`relax`/`sleep`）
4. `packs.json` の該当テーマに登録
5. ライセンス情報を `docs/ASSET_LICENSES.md` に記録

> MP3 はエンコーダのパディングでループにギャップが入るため使わないこと。
> ただし Web Audio は `decodeAudioData` で展開してから `loopEnd` を指定するので、
> **OGG なら実質問題は起きません。**

### 7.2 プロンプト例

テーマごとの key/scale/bpm/noise color は §4 の表を参照。以下はその値を反映した例。

**Study / Pad**
> minimal ambient pad, sustained warm analog synthesizer, A minor (aeolian) drone, slow evolving texture, no melody, no percussion, no vocals, calm and unobtrusive, seamless loop, 32 seconds

**Study / Pulse**
> soft minimal electronic pulse, 68 BPM, muted low kick only, very low intensity, no melody, no bass line, steady and hypnotic, seamless loop

**Study / Texture**
> subtle pink noise bed, no music, no melody, constant level, seamless loop

**Work / Texture**
> pink noise blended with faint office room hum, no music, no melody, constant level, seamless loop

**Move / Pad**
> bright ambient pad, E major pentatonic, energetic but not busy, no percussion, no melody, seamless loop, 24 seconds

**Move / Pulse**
> bright rhythmic pulse, 112 BPM, crisp percussive tick with short noise transient, no melody, no bass line, driving and energetic, seamless loop

**Move / Cell（ワンショット）**
> single bright pluck / mallet tone, E4, quick decay, isolated single note

**Relax / Pad**
> spacious ambient pad, D lydian, airy and bright, wide stereo, very slow movement, no percussion, no melody, seamless loop, 30 seconds

**Relax / Texture**
> gentle rain on leaves with distant birds, natural field recording style, no music, calm, seamless loop

**Sleep / Pad**
> very slow deep ambient pad, D minor (aeolian), low register, extremely subtle movement, no percussion, no melody, seamless loop, 30 seconds

**Sleep / Texture**
> deep brown noise, no high frequencies, no music, calm and enveloping, seamless loop

**Cue（全テーマ共通）**
> single soft chime, warm and clear, gentle attack, medium decay, isolated

### 7.3 インパルス応答（リバーブ）

`ConvolverNode` に実測IRを食わせられるのは Web の隠れた強みです。
アルゴリズミックリバーブと違い、本物の空間の残響がそのまま使えます。

- Study / Work には**小さめの部屋**のIR（近く、明瞭）— `room_small`
- Move には**タイトでドライな**IR（推進力を殺さない）— `room_dry`
- Relax には**大きなホール**や教会のIR（遠く、広い）— `hall_large`
- Sleep には Relax よりさらに長く暗いIR（低域寄り）— `hall_deep`
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
| ループ長 | `pulse-loop.ts` の `isPulseLoopAligned` が純粋関数として保証し、`packs.test.ts` が `packs.json` の全テーマで実際に `loopSeconds × bpm / 60` が整数であることを検証する |
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
