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
| 想定用途 | 本を読む・参考書と向き合う学習（言語処理中心） | PC作業・仕事、および作曲/ライティングなどの創造的作業 | 軽い運動・移動中 |
| Key / Scale | A Aeolian | A Dorian | E Major Pentatonic |
| BPM | 68（安静時心拍に近い一定リズム） | 76（Studyよりやや速く覚醒度を上げる） | 120（運動的・明るいテンポ、安静時心拍よりやや速い） |
| Pad の音色 | サイン波中心、装飾なし（シンプルさ優先） | 木質楽器/弦楽器のボディ共鳴を模した帯域（700Hz付近）を付与（ADR-007、Endel "Deep Work"） | 明るい register（e4）、major pentatonic の開放感 |
| Texture | ピンクノイズをさらに軽くローパス（4600Hz）して暖かく（ADR-007） | ピンクノイズ＋"room"（木質の部屋を思わせる250–2200Hz帯域ノイズ。旧"hum"から置き換え） | 高域寄りの軽いエア質感（マスキングより開放感） |
| Pulse (Sustain) | 0.36（控えめ、一定） | 0.44（やや前に出るが、ハイハットは控えめ） | 0.58（強く推進力を出す） |
| Cell 発火頻度 | 約11秒に1回 | 約9秒に1回（ADR-007で0.13→0.11に減らした） | 約6秒に1回（生気） |
| Reverb (Sustain) | 0.20（小部屋、明瞭） | 0.20（没入感、ADR-007で0.16から増やした） | 0.10（さらにドライ、パンチを殺さない） |
| Low-pass (Sustain) | 5400Hz（ADR-007で6000Hzから下げ、低覚醒・暖かい印象に） | 7200Hz | 9500Hz（明るく開放的） |
| 根拠 | ChatGPT報告「作業タイプ依存性」表: 集中学習は一定テンポ・歌詞なし・ピンクノイズ・音量中。timbre研究: 低いスペクトル傾斜＝肯定的な感情価 | Endel "Deep Work": 弦楽器/鍵盤/木質音・ゆったりしたテンポ・没入感のあるハーモニー。ライティングは言語処理を伴うため装飾音は控えめに（ADR-007） | 両報告: 明るいテンポの音楽が気分と覚醒度を高める（100–140BPM） |

**設計根拠（共通）**（`01_ENDEL_RESEARCH.md` §4 と ChatGPT/Gemini報告の合意点）
- 「一定のビートが長時間の集中を助ける」→ `pulse` を Sustain 区間で完全に一定に保つ
- 「刺激的だが決して気を散らさない」→ Sustain 中の変化は無し。メロディックな展開を作らない
- Cell はスケール内の音だけを選ぶ（`CellScheduler`）ので、密度をどれだけ上げても不協和にならない
- 歌詞・言語情報のある音は一切使わない（無関連発話効果 / ISE、Gemini報告 §3.1）
- （`03_ARCHITECTURE.md` ADR-005）Endel Science（"stimulate concentration without pulling you
  away from the task"）と Haruvi et al. 2022（PMC8829886）を踏まえ、Cell の定位幅・音量を
  さらに絞り、実音源の硬さを和らげてある。集中力そのものより「聞きよさ」を最終仕上げの軸にした

### 4.2 Break 系テーマ（Relax / Sleep）

rev.3.6（`03_ARCHITECTURE.md` ADR-008）から、Relax と Sleep は区間構造そのものが異なる。
Relax は従来通り Release/Rest/Re-engage の3区間、Sleep は「入眠 → 深い睡眠」という
時間経過そのものを表現する専用の区間構造を持つ。

#### 4.2.1 Relax（shortBreak）— Release / Rest / Re-engage

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.12 | **Release** | 緊張を解く。リバーブが一気に広がる |
| 0.12 – 0.80 | **Rest** | 自然音・柔らかい旋律パルスが主役。密度は最小。ゆるやかな呼吸 |
| 0.80 – 1.00 | **Re-engage** | わずかに明るさを戻す。t=0.98 で cue 音 |

| 項目 | 値 |
|---|---|
| Key / Scale / BPM | D Lydian, 70bpm |
| Texture | 雨・葉音／波（自然音、ソフトファシネーション） |
| Pulse (Rest) | 0.32 — `generateArpeggioPulse` による柔らかい旋律フレーズ（7拍で山なりに登り降り）。rev.3.6 で新設 |
| Reverb (Rest) | 0.65（大きなホール） |
| Low-pass (Rest) | 1800Hz |
| 呼吸 LFO | 0.08Hz / depth 0.12（約12.5秒周期） |

**設計根拠**: 自然音はストレスを軽減しソフトファシネーションを提供する（両報告）→ texture を
主役にし、pad は背景に回す。Study/Work/Move のような打楽器的な拍は入れない（休憩に
「作業的な拍」があると身体が作業モードを維持してしまうため）が、
deep-research-report_relux_chatGPT.md の「反復性や予測可能性が高いリズムが安定感を高める」
「60–80BPM・柔らかく単純な旋律」という知見を踏まえ、フェルトピアノ的な音色の柔らかい
旋律パルスを新たに追加した（「音楽性をある程度」という要望に応える）。

#### 4.2.2 Sleep（longBreak / Home フリー再生）— 入眠 → 深い睡眠

Sleep だけは Release/Rest/Re-engage 型ではなく、時間経過に伴って**継続的な刺激から
なめらかに遠ざかっていく**専用の区間構造を持つ。Home のフリー再生では実時間で t が進む
（`apps/web/lib/soundscapeRuntime.ts` の `SLEEP_VIRTUAL_DURATION_SEC` = 100分。
40分がちょうど t=0.4 に一致する）。

| t（実時間の目安、フリー再生時） | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.05（0–5分） | **Release** | 静かに始まる |
| 0.05 – 0.35（5–35分） | **Onset（入眠）** | 「最初40分は入眠用の音」。柔らかい旋律パルスを含め音楽性を持たせる。反復的で予測可能な短いフレーズ |
| 0.35 – 0.42（35–42分） | （移行） | Onset → Deep へなめらかに移行 |
| 0.42 – 1.00（42–100分） | **Deep（深い睡眠）** | 「睡眠をより深くするための音」。pulse は完全に消え、cell もごくまれに。pad/texture は継続的に音量を下げ、reverbWet は遠く・lowPassHz は暗くなっていく |

> t=1.0 以降（100分を超えた実時間）は t が `Math.min(1, ...)` で頭打ちになるため、
> 自動化は t=1.0 の値のまま止まり、その最も静かな状態を一晩中保持し続ける。
> Relax のような「Re-engage で音量を戻す」演出はあえて入れていない。

| 項目 | Onset (t≈0.2) | Deep (t≈0.7) |
|---|---|---|
| Key / Scale / BPM | D Aeolian・低い register, 60bpm | 同左 |
| Texture | ブラウンノイズ 0.28–0.30 | ブラウンノイズ 0.08 まで減衰 |
| Pad | 0.70–0.75 | 0.15–0.18 まで減衰 |
| Pulse | 0.30（`generateArpeggioPulse`、8拍中3拍だけ鳴る疎らな短三和音） | 0.0（完全に消える） |
| Cell 発火頻度 | 約30秒に1回 | 約3〜4分に1回 |
| Reverb | 0.68–0.72 | 0.80–0.85（さらに大きく遠く） |
| Low-pass | 1050–1100Hz | 600–750Hz（さらに暗く） |
| 呼吸 LFO | 0.035Hz / depth 0.14（約29秒周期） | 同左（一定） |

**設計根拠**（`03_ARCHITECTURE.md` ADR-008）: deep-research-report_relux_chatGPT.md の
最重要の知見 — 基礎研究（Basner 2026）でピンクノイズ50dBの継続再生により**REM睡眠が
平均約19分短縮**したとの報告があり、白色/ピンクノイズ機の連続使用は「逆にREMや深睡眠を
減少させる可能性が指摘されている」。レポートの推奨は「就寝後はタイマーで停止し、
静寂や耳栓で深睡眠に移行する」。したがって「40分後に深い睡眠用の**別の音**」を鳴らすのではなく、
**刺激を段階的に減らし静寂に近づけていく**ことこそが「睡眠をより深くする音」であると解釈した。

### 4.3 対照表（実装時のチェックリスト）

| 要素 | Study | Work | Move | Relax | Sleep |
|---|---|---|---|---|---|
| 拍（打楽器） | あり・一定 68bpm | あり・一定 76bpm（ハイハット控えめ） | あり・一定 120bpm | なし | なし |
| 旋律パルス | なし | なし | なし | あり・70bpm（柔らかいアルペジオ、ADR-008） | あり・60bpm（Onsetのみ、Deepで消える、ADR-008） |
| Noise color | ピンク（さらに暖色化） | ピンク＋"room"（木質の部屋） | 軽いエア（ハイパス強め） | 自然音（雨/波） | ブラウン（Deepでさらに減衰） |
| Pad の装飾 | なし（サイン波中心） | 木質/弦楽器ボディ共鳴（ADR-007） | なし | なし | なし |
| Reverb | 小部屋 0.20–0.38 | 小部屋〜やや没入 0.20–0.34 | ドライ 0.10–0.14 | ホール 0.45–0.65 | 0.50（Onset）→0.85（Deep、さらに遠く） |
| Low-pass | 5400Hz | 7200Hz | 9500Hz | 1800–3000Hz | 1500Hz（Onset）→600Hz（Deep、さらに暗く） |
| Cell 発火頻度 | 約11秒に1回 | 約9秒に1回 | 約6秒に1回 | 約24–40秒に1回 | 約30秒（Onset）→約3〜4分（Deep）に1回 |
| 呼吸 | 無し | 無し | 無し | 0.08Hz | 0.035Hz（一晩を通じて一定） |
| Pomodoro での役割 | Focus（選択可） | Focus（選択可・既定） | Focus（選択可） | shortBreak（固定） | longBreak（固定）／Home フリー再生（実時間でフェーズ進行、ADR-008） |

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
2. **テイクの扱い**: Texture / Pulse はセッション開始時にシードでランダムに1テイクを選び固定する。
   **Pad だけは全テイクを同時再生し、音量LFOでブレンドをドリフトさせる**（§6.3.1、rev.3.3）
3. **周期のずらし**: pad(32秒) / texture(20秒) / pulse(7.27秒) のように**互いに素に近い長さ**にする
4. **微小デチューン**: `playbackRate` を ±0.3% の範囲でテイクごとに変える

#### 6.3.1 Pad Ensemble — 和声/音色のゆったりしたドリフト（`03_ARCHITECTURE.md` ADR-006）

Endel Science / PMC8829886 の文献調査を踏まえ、「BGM性・音楽性を足すが集中を妨げない」ための
仕掛けとして、Pad 層に **Brian Eno の "Music for Airports" 由来のテープループ・フェイジング
技法**を実装した。長さの異なるループを同時に回し続けると、離散的な「切り替わり」なしに
組み合わせが無限に変化する — これを Web Audio の LFO（`OscillatorNode` → `GainNode.gain`）で
再現している。

```ts
// packages/audio-engine/src/phase-graph.ts の addPadEnsemble（概念）
buffers.forEach((buffer, idx) => {
  const source = ctx.createBufferSource(); // 全テイクを同時ループ再生
  source.buffer = buffer;
  source.loop = true;

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0.55; // baseline

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 1 / PAD_DRIFT_PERIODS_SEC[idx]; // 43/59/71/83秒など、互いに素に近い周期
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 0.45;
  lfo.connect(lfoDepth).connect(voiceGain.gain); // AudioParamへのconnectはvalueに加算される

  source.connect(voiceGain).connect(layerGain); // layerGain は既存の Pad 全体音量（Ease-in/Sustain/Taper/Wind-down）
});
```

**なぜコード進行ではなくドリフトなのか**: 和声の研究（ERAN）によれば、予測を外れた
コード進行は聴取後150–200msで脳波上の「予測誤差」反応を引き起こす。離散的な和声変化
（特にドミナント→トニックのケーデンス）は「解決」を求める心理的圧力を生み、注意を引く。
一方、連続的でなめらかなドリフトには「切り替わりの瞬間」が存在しないため、Eno の言う
"ignorable as it is interesting" な質感になる。全テイクは同一キー/スケールで作られているため、
どんな混合比になっても不協和にはならない。

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

### 6.5.1 Pulse — キックドラムのグルーヴ（`03_ARCHITECTURE.md` ADR-006）

Pulse 層は元は固定周波数のクリック音だったが、「ドラムのキック音で人の活動に合わせた
リズムを作る」ための改良として、`scripts/generate-placeholder-audio.mjs` の `generatePulse`
を以下のように拡張した:

- **ピッチドロップ式キック合成**: 固定周波数のサイン波ではなく、`toneStartHz → toneEndHz`
  へ位相を毎サンプル積分しながら指数的に下降させる。実際のキックドラム（膜鳴楽器）に近い
  「ドスン」という質感になる
- **オフビートのハイハット**（Work / Move のみ）: 拍の裏に軽い高域ノイズバーストを添えて
  グルーヴ感を出す。Study には追加しない — 文献（Georgetown大学の"work flow"音楽研究）が
  複雑思考タスクには low rhythmic complexity を支持しているため

いずれもテンポは一定（isochronous）のまま。シンコペーションやフィルは入れない
（Sun 2025: 急激なリズム/ダイナミクス変化を持つ楽曲は作業フローを阻害する）。

#### Relax / Sleep の旋律パルス（`generateArpeggioPulse`、ADR-008）

Relax と Sleep の Pulse は打楽器的なキックではなく、`generateArpeggioPulse`
（`scripts/generate-placeholder-audio.mjs`）による**柔らかい旋律フレーズ**にしている。
`generateOneShot` と同じ倍音構成（フェルトピアノ/マレット的な音色）で、拍ごとに
スケール内の音程を辿る短いフレーズをループさせる。deep-research-report_relux_chatGPT.md
の「反復性や予測可能性が高いリズムが安定感を高める」「60–80BPM・柔らかく単純な旋律」を
根拠にしている。Sleep は8拍中3拍しか鳴らさない疎らなパターンにして、Onset フェーズを
過ぎると automation 側で音量を0まで落とす（§4.2.2）。

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
> subtle warm pink noise bed, slightly rolled-off high end like a quiet library, no music, no melody, constant level, seamless loop

**Work / Pad**
> warm ambient pad with a subtle wooden/string body resonance, A dorian, smooth synthesized string/keyboard/wood tones, slow evolving texture, no melody, no percussion, no vocals, immersive but unobtrusive, seamless loop, 30 seconds

**Work / Texture**
> pink noise blended with a warm room-toned noise bed (250–2200Hz, like being inside a wood-paneled room), no office hum, no music, no melody, constant level, seamless loop

**Move / Pad**
> bright ambient pad, E major pentatonic, energetic but not busy, no percussion, no melody, seamless loop, 24 seconds

**Move / Pulse**
> bright rhythmic pulse, 120 BPM, crisp percussive tick with short noise transient, no melody, no bass line, driving and energetic, seamless loop

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
