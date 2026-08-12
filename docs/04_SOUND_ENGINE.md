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
        ├─ Pulse   … テーマごとに性格が異なる（拍/コンピング/実ドラム/柔らかい旋律/疎らな一音、§4.6）
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
          "automation": { "pad": [ /* keyframes */ ], "texture": [], "pulse": [], "cellDensity": [], "reverbWet": [], "lowPassHz": [] }
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

**rev.4（`03_ARCHITECTURE.md` ADR-009）で全テーマを再設計した。** 旧設計（rev.3系）は
Study と Work がほぼ同じ構造（どちらも打楽器的な pulse を持つだけ）で使い分けが分かりにくく、
Move も Study/Work と同じ弧をテンポだけ変えて流用していた。Relax は reverbWet の大きな
振れ幅と Pad Ensemble のドリフトが組み合わさり「リバーブが上下に呼吸するように膨らんでは
萎む」不快感を生んでいた（いずれもユーザーからの実聴フィードバック）。rev.4 では
Endel の公開設計方針（endel.io/science, endel.io/focus, endel.io/activity, endel.io/relax）を
参照し、**テーマごとに「拍の有無・性格」から作り直した**（詳細は ADR-009）。
根拠文献は上記に加え `docs/deep-research-report_chatGPT.md`（ChatGPT報告）と
`集中力を高める音の文献調査_gemini.md`（Gemini報告）。

### 4.1 Study — 読書・参考書での学習（拍を持たない没入型）

Endel の "Read" は規則的な拍を持たない没入型サウンドスケープであり、読解は言語処理そのもの
であるため外部リズムと競合しうる（`03_ARCHITECTURE.md` ADR-007 で既出）。そのため
Study は **Study/Work/Move の中で唯一「拍」を持たない**テーマにした。

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.06 | **Ease-in** | 静かに立ち上がる |
| 0.06 – 0.85 | **Sustain** | ほぼ変化しない。ここで音が動くと注意が奪われる |
| 0.85 – 0.95 | **Taper** | Cell の密度を落とし、終わりが近いことを無意識に伝える |
| 0.95 – 1.00 | **Wind-down** | 静かな一音の余韻だけが残る。t=0.98 で cue 音 |

| 項目 | 値 |
|---|---|
| Key / Scale / BPM | A Aeolian, 68bpm（拍としては聞こえない。一音の間隔の基準にのみ使う） |
| Pad（主役） | 3テイクの和音を少しずつ変えて（Ensemble ドリフトで奥行きを出す）。装飾は最小限 |
| Texture（主役） | ピンクノイズをさらに軽くローパス（4600Hz）して暖かく（ADR-007） |
| Pulse (Sustain) | 0.16 — `generateArpeggioPulse` を極端に間引いた設定（8拍中1音のみ）。「拍」ではなく、まれに響く一音の余韻 |
| Cell 発火頻度 | 約14秒に1回 |
| Reverb (Sustain) | 0.16（小部屋、明瞭） |
| Low-pass (Sustain) | 4800Hz（暖かい・低覚醒） |

**設計根拠**: 「刺激的だが決して気を散らさない」以前に、そもそも刺激（拍）を持ち込まない。
主役は Pad の静かな一定和音とピンクノイズによるマスキングで、Sustain 区間 (0.06–0.85) は
ほぼ変化しない。歌詞・言語情報のある音は一切使わない（無関連発話効果 / ISE、Gemini報告
§3.1）。Cell はスケール内の音だけを選ぶ（`CellScheduler`）ので、不協和にはならない。

### 4.2 Work — PC作業・仕事、および作曲・ライティングなどの創造的作業（規則的な拍）

endel.io/science: 「規則的な拍が長時間の集中を助ける」という Endel の公開方針をそのまま
採用し、Study とは対照的に**明確な拍を持たせる**。Endel "Deep Work"
（"smooth ... string, keyboard and wood notes, immersive background harmony"）を参考に、
Pad には木質楽器/弦楽器のボディ共鳴を付与（ADR-007）。Pulse はキック+オフビートハイハットの
グルーヴに加え、`generateGroovePulse` による短いコンピング動機（1〜3音のフレーズ）を重ね、
「拍はあるが音楽的な一節も乗る」という Study・Move との中間的な性格にした。

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.06 | **Ease-in** | 静かに立ち上がる。パルスは遅れて入る |
| 0.06 – 0.85 | **Sustain** | ほぼ変化しない |
| 0.85 – 0.95 | **Taper** | Cell の密度を落とす |
| 0.95 – 1.00 | **Wind-down** | パルスが消え、パッドだけが残る。t=0.98 で cue 音 |

| 項目 | 値 |
|---|---|
| Key / Scale / BPM | A Dorian, 76bpm |
| Pad | 木質楽器/弦楽器のボディ共鳴を模した帯域（700Hz付近、ADR-007） |
| Texture | ピンクノイズ＋"room"（木質の部屋を思わせる250–2200Hz帯域ノイズ） |
| Pulse (Sustain) | 0.42 — キック+オフビートハイハット+短いコンピング動機（`generateGroovePulse`） |
| Cell 発火頻度 | 約10秒に1回 |
| Reverb (Sustain) | 0.22（没入感） |
| Low-pass (Sustain) | 7000Hz |

**設計根拠**: 作曲・ライティングは言語/音楽処理そのものを行うタスクであり、装飾音の主張が
強いと自分の思考と競合しうるため（ADR-007）、コンピング動機は短く控えめ（noteSec 0.7秒・
gain 0.2）に留めた。

### 4.3 Move — 筋トレ・運動（構造自体が別物。実際のドラムパターン）

Study/Work とは活動内容がまったく異なるため、**弧の構造そのものを作り替えた**
（旧設計は同じ弧をテンポだけ変えて流用しており、「同じにしか聞こえない」という指摘を受けた）。
Endel "Activity" はケイデンス（運動のリズム）に同調する打楽器を主役にする。運動は
「今すぐ動き出す」文脈のため、他テーマのような穏やかなイーズインをやめた。

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.02 | **Drop-in** | ほぼ即座にフルゲイン。拍はすでに t=0 から鳴っている |
| 0.02 – 0.85 | **Sustain** | 明確なドラムパターンが続く |
| 0.85 – 0.97 | **Taper** | Cell 密度・パルスをやや落とす |
| 0.97 – 1.00 | **Cool-down** | パルスが下がる。t=0.98 で cue 音 |

| 項目 | 値 |
|---|---|
| Key / Scale / BPM | E Major Pentatonic, 128bpm（一般的なワークアウト楽曲のテンポ帯） |
| Pad | `generatePad` の `pumpBpm` オプションで拍ごとダッキングする「サイドチェイン風」のポンピング。和音の土台自体をリズムに同調させる |
| Texture | 高域寄りの軽いエア質感（マスキングより開放感、抑えめ） |
| Pulse (Sustain) | 0.72 — `generateWorkoutGroove` によるキック+スネア(2・4拍目)+ハイハット(8分)の実際のドラムパターン |
| Cell 発火頻度 | 約4.5秒に1回（エネルギー感） |
| Reverb (Sustain) | 0.05（ほぼドライ） |
| Low-pass (Sustain) | 9800Hz（明るく開放的） |

**設計根拠**: Study/Work/Relax/Sleep の「空間に包まれる」方向性から明確に切り離し、
Pad も含めて音の土台そのものが拍に同調する点が他テーマとの決定的な違い。

### 4.4 Relax — 短い休憩（"simple... no beat... easy to process"）

endel.io/relax: "don't include beats or complex sound textures — simple sound structures
that are easy for your brain to process"。ADR-008 で追加した柔らかい旋律アルペジオ
（`generateArpeggioPulse`、拍ではなく歌のようなフレーズ）は「ある程度の音楽性」のために
維持しつつ、**振れ幅を大きく抑えて全体をほぼ静止させた**（ADR-009）。

| t | 区間名 | 意図 |
|---|---|---|
| 0.00 – 0.15 | **Release** | 緊張を解く。ただし旧版のような大きなリバーブの跳ね上がりはしない |
| 0.15 – 0.85 | **Rest** | 自然音・柔らかい旋律が主役。ほぼ一定 |
| 0.85 – 1.00 | **Re-engage** | わずかに明るさを戻す。t=0.98 で cue 音 |

| 項目 | 値 |
|---|---|
| Key / Scale / BPM | D Lydian, 64bpm |
| Texture | 雨・葉音／波（自然音、ソフトファシネーション） |
| Pulse (Rest) | 0.22 — `generateArpeggioPulse`（7拍で山なりに登り降り）。旧版よりテンポを落とし、減衰も長く緩やかに、音量も下げた |
| Reverb (Rest) | 0.40（旧 0.65 から縮小） |
| Low-pass (Rest) | 2000Hz |

**設計根拠（ADR-009 で追加）**: 旧設計は pad 0.47→0.77、reverbWet 0.45→0.65 と大きく
動いており、Pad Ensemble のドリフト（`phase-graph.ts` の `PAD_DRIFT_DEPTH`、当時0.45）と
組み合わさって「リバーブが上下に呼吸するように膨らむ」不快感の原因になっていた
（ユーザー報告）。根本原因である `PAD_DRIFT_DEPTH` を 0.45→0.18 に縮小した上で、
Relax 側の pad/texture/reverbWet の振れ幅もいずれも半分以下に抑え、二重に対策した。

### 4.5 Sleep — 深い休憩・入眠（入眠 → 深い睡眠、ADR-008 の構造を維持）

Sleep だけは Release/Rest/Re-engage 型ではなく、時間経過に伴って**継続的な刺激から
なめらかに遠ざかっていく**専用の区間構造を持つ（ADR-008）。Home のフリー再生では実時間で
t が進む（`apps/web/lib/soundscapeRuntime.ts` の `SLEEP_VIRTUAL_DURATION_SEC` = 100分。
40分がちょうど t=0.4 に一致する）。ADR-009 では Relax と同じ理由（Pad Ensemble ドリフトとの
相互作用）で pad/reverbWet のピーク値をやや下げ、より確実に「膨らみ過ぎない」ようにした。

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
| Texture | ブラウンノイズ 0.24–0.26 | ブラウンノイズ 0.07–0.08 まで減衰 |
| Pad | 0.58–0.62 | 0.15–0.18 まで減衰（旧 0.70–0.75 から縮小、ADR-009） |
| Pulse | 0.24（`generateArpeggioPulse`、8拍中3拍だけ鳴る疎らな短三和音） | 0.0（完全に消える） |
| Cell 発火頻度 | 約33秒に1回 | 約4分に1回 |
| Reverb | 0.56–0.66 | 0.66–0.70（さらに大きく遠く。旧 0.80–0.85 から縮小、ADR-009） |
| Low-pass | 1100–1150Hz | 650–800Hz（さらに暗く） |

**設計根拠**（`03_ARCHITECTURE.md` ADR-008）: deep-research-report_relux_chatGPT.md の
最重要の知見 — 基礎研究（Basner 2026）でピンクノイズ50dBの継続再生により**REM睡眠が
平均約19分短縮**したとの報告があり、白色/ピンクノイズ機の連続使用は「逆にREMや深睡眠を
減少させる可能性が指摘されている」。レポートの推奨は「就寝後はタイマーで停止し、
静寂や耳栓で深睡眠に移行する」。したがって「40分後に深い睡眠用の**別の音**」を鳴らすのではなく、
**刺激を段階的に減らし静寂に近づけていく**ことこそが「睡眠をより深くする音」であると解釈した。

### 4.6 対照表（実装時のチェックリスト）

| 要素 | Study | Work | Move | Relax | Sleep |
|---|---|---|---|---|---|
| 拍の性格 | なし（極めて疎らな一音のみ） | あり・一定 76bpm（キック+ハット+コンピング動機） | あり・一定 128bpm（実際のドラムパターン） | なし（柔らかい旋律のみ） | なし（Onsetのみ柔らかい旋律） |
| Pad の性格 | 静かな一定和音 | 木質/弦楽器ボディ共鳴（ADR-007） | 拍同期ポンピング（ADR-009） | 静かにほぼ一定 | Onset→Deepで継続的に減衰 |
| Noise color | ピンク（さらに暖色化） | ピンク＋"room"（木質の部屋） | 軽いエア（控えめ） | 自然音（雨/波） | ブラウン（Deepでさらに減衰） |
| Reverb | 小部屋 0.16–0.32 | 小部屋〜やや没入 0.22–0.36 | ほぼドライ 0.05–0.12 | ホール 0.32–0.40（ADR-009で縮小） | 0.42（Onset）→0.70（Deep、ADR-009で縮小） |
| Low-pass | 4800Hz | 7000Hz | 9800Hz | 2000–2800Hz | 1150Hz（Onset）→650Hz（Deep） |
| Cell 発火頻度 | 約14秒に1回 | 約10秒に1回 | 約4.5秒に1回 | 約29–50秒に1回 | 約33秒（Onset）→約4分（Deep）に1回 |
| Pomodoro での役割 | Focus（選択可） | Focus（選択可・既定） | Focus（選択可） | shortBreak（固定） | longBreak（固定）／Home フリー再生（実時間でフェーズ進行、ADR-008） |

### 4.7 状況適応レイヤー（天気・時間帯・経過時間、`03_ARCHITECTURE.md` ADR-010）

§4.1–4.6 の `PhaseAutomation` はテーマ・t だけで決まる**基準値**。rev.5（ADR-010）で、
そこに天気・時間帯・経過時間による**控えめな補正**（`EnvironmentModifier`）を上乗せできる
ようにした。`PhaseGraph.tick(t, now, environment)` の第3引数で、テーマの基準値を保ったまま
状況に応じて微調整する。

```
最終値 = PhaseAutomation(t) の基準値 × / + EnvironmentModifier
```

| 軸 | 判定材料 | 効いてくるパラメータ |
|---|---|---|
| 天気 | Geolocation + Open-Meteo（`apps/web/lib/environment.ts`）を4カテゴリに単純化 | lowPassFactor、reverbWetDelta、rainOverlayGain（雨のときだけ既存の `texture_rain.wav` を全テーマ共通で薄く重ねる） |
| 時間帯 | 端末のローカル時刻（朝5–11時/昼11–17時/晩17–5時） | lowPassFactor、reverbWetDelta、padGain |
| 経過時間 | 音を鳴らし始めてからの実時間（Pomodoroのフェーズをまたいで積算） | pulseGain、cellDensityFactor（45分を超えたら3時間かけて最大18%まで緩やかに減衰） |

**「ゆっくりなだらかに切り替える」の実装**: `targetEnvironmentModifier()` が計算するのは
あくまで瞬間の目標値。`apps/web/lib/soundscapeRuntime.ts` が毎ティック
`smoothEnvironment(current, target, dtSec, τ=90秒)` で指数的に近づけてから
`engine.tick()` に渡す。天気が変わっても数分かけてなじむように聞こえる。

**「気分に合わせる」の解釈**（ユーザー指摘、ADR-010 に詳細）: 気分に**似た**音を流すのではなく、
そのテーマが導きたい心理状態を壊さない範囲で彩りを加える。そのため全軸の効果量は
控えめ（目安 ±20%以内）に設計し、`environment.ts` の `clampModifier` で3軸合成後の値にも
最終的な安全域を設けている。天気・時間帯でテーマの拍構造や楽器編成（§4.1–4.6）自体が
変わることはない。

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
}

/** 純粋関数。ユニットテストの主対象。 */
export function valueAt(kf: Keyframes, t: number): number;

/** 天気・時間帯・経過時間による補正（§4.7、ADR-010）。gain系は乗算、reverbWetDeltaは加算。 */
export interface EnvironmentModifier {
  readonly padGain: number;
  readonly textureGain: number;
  readonly pulseGain: number;
  readonly cellDensityFactor: number;
  readonly reverbWetDelta: number;
  readonly lowPassFactor: number;
  readonly rainOverlayGain: number;
}

export type WeatherCategory = 'clear' | 'cloudy' | 'rain' | 'snow';
export type TimeOfDay = 'morning' | 'noon' | 'evening';

/** 純粋関数群。3軸から目標値を合成し(targetEnvironmentModifier)、なだらかに近づける(smoothEnvironment)。 */
export function targetEnvironmentModifier(ctx: {
  weather: WeatherCategory | null;
  timeOfDay: TimeOfDay;
  sessionElapsedSec: number;
}): EnvironmentModifier;
export function smoothEnvironment(
  current: EnvironmentModifier,
  target: EnvironmentModifier,
  dtSec: number,
  tauSec?: number,
): EnvironmentModifier;

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

  /**
   * useTimer から約10Hzで呼ばれる。t は 0.0–1.0。
   * environment は天気/時間帯/経過時間による控えめな補正（§4.7、ADR-010）。省略時は無補正。
   */
  tick(t: number, environment?: EnvironmentModifier): void;

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

### 6.5.1 Pulse — テーマごとに性格の異なる4種類の生成器（`03_ARCHITECTURE.md` ADR-006/ADR-009）

Pulse 層は元は全テーマ共通の固定周波数クリック音だったが、rev.4（ADR-009）で
**テーマごとに完全に異なる生成器**を使うようにした（`scripts/generate-placeholder-audio.mjs`）。

- **`generatePulse`（キック単体、基礎DSP）**: 固定周波数のサイン波ではなく
  `toneStartHz → toneEndHz` へ位相を毎サンプル積分しながら指数的に下降させる、実際の
  キックドラム（膜鳴楽器）に近い「ドスン」という質感の合成器。他の生成器から内部的に呼ばれる
- **`generateGroovePulse`（Work 専用）**: `generatePulse` のキック+オフビートハイハットに、
  `generateArpeggioPulse` と同系統の短いコンピング動機（1〜3音のフレーズ）を重ねる。
  endel.io/science の「規則的な拍が集中を助ける」を採用しつつ、Endel "Deep Work" の
  楽器的な質感も併せ持たせた
- **`generateWorkoutGroove`（Move 専用）**: キック+スネア(クラップ、2・4拍目)+ハイハット(8分)の
  実際のドラムパターンを合成する。Study/Work の「装飾的なキック」より明確に「曲のビート」として
  聞こえることを狙い、運動のケイデンスに同調する用途に合わせた
- **`generateArpeggioPulse`（Study/Relax/Sleep）**: 打楽器ではなく、スケール内の音程を辿る
  柔らかい旋律フレーズ（フェルトピアノ/マレット的な音色）。Study は8拍中1音だけの極端に
  疎らな設定（「拍」に聞こえない密度）、Relax/Sleep は ADR-008 の設計のまま（後述）

いずれもテンポは一定（isochronous）のまま。シンコペーションやフィルは Move 以外には入れない
（Sun 2025: 急激なリズム/ダイナミクス変化を持つ楽曲は作業フローを阻害する）。

#### Study の疎らな一音（ADR-009）

Endel "Read" は規則的な拍を持たない。Study の Pulse は `generateArpeggioPulse` を
8拍に1音だけ鳴る設定（他は休符）で使い、「拍」ではなく、ページをめくるようなごくまれな
残響として存在させている。

#### Relax / Sleep の旋律パルス（`generateArpeggioPulse`、ADR-008/ADR-009）

Relax と Sleep の Pulse は打楽器的なキックではなく、**柔らかい旋律フレーズ**にしている。
拍ごとにスケール内の音程を辿る短いフレーズをループさせる。deep-research-report_relux_chatGPT.md
の「反復性や予測可能性が高いリズムが安定感を高める」「60–80BPM・柔らかく単純な旋律」を
根拠にしている。Sleep は8拍中3拍しか鳴らさない疎らなパターンにして、Onset フェーズを
過ぎると automation 側で音量を0まで落とす（§4.5）。ADR-009 で Relax のテンポを70→64bpmに
落とし、減衰も長く緩やかにして、より主張の弱い存在にした（§4.4 参照）。

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
