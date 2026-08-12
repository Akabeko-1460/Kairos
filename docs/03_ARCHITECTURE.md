# 03. アーキテクチャ・技術選定（rev.2）

---

## ADR-001: PC / Web をメインターゲットとする

### 決定
**Webアプリを最優先**とし、PC ブラウザを主戦場にする。モバイルは PWA で提供する。
デスクトップのネイティブアプリ（Tauri / Electron）は**作らない**。

### 理由
- 主要な利用シーンがデスクワーク中の集中であり、PCブラウザで完結する
- Web なら配布・更新にストア審査が不要で、イテレーションが最速で回る
- デスクトップは **バックグラウンド再生の制約がない**（ウィンドウが開いている限りプロセスが生きる）。
  モバイルOSの制約を回避するためだけにネイティブが必要だったので、PC主戦場ならその理由が消える
- PWA として「ホーム画面に追加」すればモバイルでも動く

### 影響
`02_SPEC.md` の F-13（アプリを閉じても再生継続）と F-14（ロック画面制御）は、
**モバイルネイティブ化するまで対象外**になる。代わりに Media Session API による
デスクトップのメディアキー対応を Phase 3 に入れる。

---

## ADR-002: フレームワークは Next.js (App Router)

### 決定
**Next.js 15 + React 19 + TypeScript**。`output: 'export'` による静的書き出し。

### 理由
- 開発者が慣れており、UI 実装で悩む時間をゼロにできる。**音作りに時間を使うため**
- App Router のファイルベースルーティングと TypeScript のDXが良い
- Vercel などへの配信が容易

### 正直な注意
このアプリは完全にクライアントサイドかつオフライン前提なので、
**SSR / RSC / Server Actions / API Routes は一切使いません。**
Next.js は実質「使い慣れた React ビルダー」として機能します。
純粋な軽さを取るなら Vite + React でも同等のことができます。慣れを優先した選択です。

**実装上の帰結:**
- すべてのページ・コンポーネントは `'use client'`
- `next.config.js` に `output: 'export'` を設定
- 音声・タイマー関連のコードは **SSR 時に評価されてはならない**（`window` / `AudioContext` が無い）。
  動的 import か `useEffect` 内での初期化を徹底する

---

## ADR-003: 音声は素の Web Audio API。ライブラリを挟まない

### 決定
**Web Audio API を直接使う。** Tone.js・Howler.js 等のライブラリは導入しない。
必要なスケジューラは自前で書く（`04_SOUND_ENGINE.md` §4）。

### 理由

**1. 必要なものが標準で全部ある**

| 要件 | ノード |
|---|---|
| ギャップレスループ | `AudioBufferSourceNode`（`loop` / `loopStart` / `loopEnd`、サンプル精度） |
| 等パワークロスフェード | `GainNode` ×2 + `AudioParam.setValueCurveAtTime` |
| オートメーション曲線 | `AudioParam.linearRampToValueAtTime` の連鎖 |
| ローパス | `BiquadFilterNode` |
| リバーブ | `ConvolverNode`（実測インパルス応答） |
| 定位 | `StereoPannerNode` |
| マスターリミッタ | `DynamicsCompressorNode` |
| ビジュアライザ | `AnalyserNode` |
| 自動テスト・プリレンダ | `OfflineAudioContext` |

**2. Tone.js の価値がこのアプリでは小さい**
Tone.js の主価値は Transport（小節・拍の音楽的時間軸）とその上のスケジューリング。
本アプリには小節も拍もほぼ存在せず（Pulse ループが1本あるだけで、メロディとコード進行は
意図的に排除している）、恩恵を受ける部分が少ない。`Tone.Reverb` の実体は `ConvolverNode`。

**3. 将来のネイティブ移植性**
`react-native-audio-api`（Software Mansion）は Web Audio 仕様準拠なので、
素の Web Audio で書いたエンジンは**ほぼそのまま iOS / Android ネイティブで動く**。
Tone.js は `AudioWorklet` に依存しており移植できない。

### 却下した代替案
| 案 | 却下理由 |
|---|---|
| Tone.js | 上記。ただし「速く音を鳴らして感触を掴む」目的でのプロトタイピングには合理的 |
| Howler.js | 単純再生用。ノードグラフの制御ができない |
| Elementary Audio | 表現力は高いが商用ライセンスの確認が必要で、この規模には過剰 |
| WASM 自作DSP | 完全に過剰 |

### 既知の制約と対策（**必ず読むこと**）

**1. バックグラウンドタブの `setTimeout` スロットリング**
タブが非表示だと `setTimeout` / `setInterval` は毎秒1回以下に絞られ、Chrome では
数分後にさらに厳しくなる。25分セッション中に別タブへ移るのは当然の使い方なので必須対策。

- 音のスケジューリングは **Web Worker のティッカー**で駆動し、時刻基準は `AudioContext.currentTime` にする
- 常に **2〜3秒先まで**イベントを予約しておく（先読みスケジューリング）
- `AudioContext` 自体は音が鳴っている限り止まらないので、予約さえ済んでいれば途切れない
- タイマー本体は `Date.now()` の絶対時刻ベース（`02_SPEC.md` §5）

**2. メモリ**
`decodeAudioData` の結果は非圧縮 Float32。**60秒ステレオ44.1kHz ≈ 21MB**。
ステム10本で 200MB 超は現実的にあり得る。

- ループは 32秒以下
- Texture 層はモノラル
- Pad 以外は 22.05kHz でも聴感上の差は小さい
- 長尺は `MediaElementAudioSourceNode` でストリーミング
- **Phase 0 で実測してから素材長を確定すること**

**3. 自動再生ポリシー**
`AudioContext` は `suspended` で生成される。**必ずユーザー操作（Start ボタン）を起点に**
`new AudioContext()` と `resume()` を行う。

---

## ADR-004: サウンドを「フェーズ(focus/break)」単位から「テーマ(5種)」単位で再構築する

### 決定
音響定義の最小単位を `EnginePhase`（focus/shortBreak/longBreak）から `ThemeId`
（`study` / `work` / `move` / `relax` / `sleep`）に変更した。`SoundPack` は
`{ focus, break }` の2定義ではなく `themes: Record<ThemeId, ThemeSoundDefinition>` の
5定義を持つ。各 `ThemeSoundDefinition` が key/scale/bpm/layers に加えて **自分専用の
`PhaseAutomation` を内包する**（旧: `automation.ts` にフェーズ単位でハードコードされていた）。

Pomodoro の Break フェーズはユーザーが選べないため固定でテーマを割り当てる:
`shortBreak → relax`、`longBreak → sleep`（短い休憩は素早いリセット、長い休憩はより深く
鎮める、という意図的な差別化）。

### 理由
rev.2 までは Home 画面に Study/Work/Relax/Sleep/Move の5カテゴリが並んでいたが、実体は
`packs.json` の `focus`/`break` 定義2つしか無く、**カテゴリの違いは背景アートの配色だけ**で
音は完全に同一だった（Pomodoro の Focus テーマ選択も同様に音へ反映されていなかった）。
これは「テーマに合わせてすべてのサウンドを再構築する」という要求と両立しない。

`docs/research/sound-environment-focus-chatgpt.md` と `docs/research/focus-sound-literature-review-gemini.md` の
文献調査により、テーマごとに以下が異なるべきだという根拠が得られた（詳細な数値と出典は
`04_SOUND_ENGINE.md` §4 参照）:

- **ノイズ色**: ピンクノイズ(Study/Work)・ブラウンノイズ(Sleep)・軽い高域寄りのエア質感(Move)は
  それぞれ効果の方向性が違う（Gemini報告 §1.1）
- **テンポ**: 安静時心拍に近い一定テンポ(Study 68bpm)、やや速いテンポ(Work 76bpm)、
  運動的な速いテンポ(Move 112bpm)は覚醒度への影響が異なる（Gemini報告 §3.2、ChatGPT報告
  「リズム・テンポの影響」）
- **音量ダイナミクス／リバーブ**: 集中系は小さく明瞭な空間、休憩系は大きく開放的な空間
  （ChatGPT報告「音量・SNRの影響」）

これらはフェーズ単位のグローバルな自動化カーブでは表現できず、テーマ単位で完全に独立した
定義が必要だった。

### 影響
- `packages/audio-engine`: `EnginePhase`/`soundDefinitionKeyFor` を削除し `ThemeId`/`ThemeKind`
  を導入。`SoundscapeEngine.begin/transitionTo` は `phase` ではなく `theme` を受け取る
- `automation.ts` は `focusAutomation`/`breakAutomation` の2定義から
  `studyAutomation`/`workAutomation`/`moveAutomation`/`relaxAutomation`/`sleepAutomation`
  の5定義に変わった
- `apps/web/public/packs.json` は `focus`/`break` キーではなく `themes.study` などの
  5キーを持つ。各テーマが `automation` フィールドを内包する（データ駆動）
- `apps/web/lib/soundscapeRuntime.ts`: タイマーのフェーズと選択中の Focus テーマから
  再生すべき `ThemeId` を1つに決める純粋関数 `themeIdForTimerPhase` を追加。Focus 中に
  ユーザーがテーマを変更した場合も、この関数の戻り値が変わることを検知してクロスフェードする
- 既存の `focus`/`break` の2音源体系は廃止（"全テーマは同一キー/スケールに揃える" という
  制約は **テーマ内部**の話であり、テーマ間で key/scale/bpm が異なることは元々の設計
  （旧 focus=A、break=D）を踏襲している）

### 却下した代替案
- **バイノーラルビート層の追加**: 両報告とも効果を報告する一方、個人差が大きく固定音源では
  効果が不安定という指摘（Gemini報告 §2.3）があり、ヘッドフォン前提という制約も強い。
  今回はテーマの識別子を増やす基盤を作ることを優先し、バイノーラルビートは見送った
  （将来 Study テーマ限定のオプションとして再検討可能）
- **70dB付近の動的な環境ノイズによる創造性ブースト**（Gemini報告 §5, Mehta 2012）:
  非線形で環境依存性が強く、固定音量のBGMとして持ち込むと逆効果になりうるため見送った

---

## ADR-005: 「集中力を上げる」だけでなく「聞きよい（restorative）」方向へ調整する

### 決定
`endel.io/science` と Haruvi et al. (2022, PMC8829886) を追加参照し、以下を調整した:

- `CellScheduler`（`packages/audio-engine/src/cell-scheduler.ts`）: 定位幅を ±0.6 → ±0.4 に、
  ワンショットの gain レンジを 0.43–0.73 → 0.36–0.60 にさらに絞った
- 実音源由来の Cell（`packages/audio-engine/tools/process-real-audio.mjs`）: フェードインを
  0.005秒 → 0.015秒に伸ばしてクリック感を抑え、硬質な素材（学校鐘）には軽いローパス
  （4.2kHz）をかけて丸めた
- Move のテンポを 112 → 120bpm に変更（安静時心拍よりやや速い、との具体的な数値提示に合わせた）
- Move と Relax の Cell 発火頻度をやや下げた（Move: 約4.5秒に1回 → 約6秒に1回、
  Relax: 約20秒に1回 → 約24秒に1回）

### 理由
`docs/04_SOUND_ENGINE.md` §4 の設計はテーマごとの科学的根拠を反映していたが、Endel の
設計原則（"stimulate concentration **without pulling you away from the task**"、Relax/Sleep は
"restorative not entertaining" — クライマックスのない予測可能な構造）と突き合わせると、
Cell 層（装飾的なワンショット）がやや前に出すぎていた。特に Wikimedia Commons から採用した
学校鐘の実音源は素材の性質上やや硬質で、"calm and gentle" という Endel の言葉が示す方向性から
外れていた。

PMC8829886（Endel 社のEEG研究）は「パーソナライズされた音は無音より有意に集中力を高める
（効果は約2.5分で発現）」「ジャンル分析ではクラシック音楽・自然音が最高、ポップ/ヒップホップが
最低の集中スコア」と報告しており、具体的な周波数/テンポの最適値までは特定していない
（研究の限界として明記されている）。これは既存設計の骨格（歌詞なし・一定拍・ジェネラティブな
無限変化）を裏付けるものであり、今回は骨格を変えず、Cell 層の主張の強さと音色の硬さを
下げる方向で調整した。

### 影響
- `packages/audio-engine/src/cell-scheduler.ts`, `packages/audio-engine/tools/process-real-audio.mjs`,
  `apps/web/public/packs.json`, `packages/audio-engine/src/automation.ts`,
  `scripts/generate-placeholder-audio.mjs` を変更
- テーマの key/scale/kind やレイヤー構成（pad/texture/pulse/cell の役割分担）は変更していない

---

## ADR-006: BGM性・音楽性を「集中力を落とさない範囲で」足す

### 決定
ユーザー要望「集中力を向上させる効果は維持したまま、BGM性・音楽性を足す」に対し、実装前に
音楽理論・認知科学の文献調査を行い、以下2点を追加した。

1. **Pad層の和声/音色ドリフト**（`packages/audio-engine/src/phase-graph.ts` の `addPadEnsemble`）:
   従来は3テイクの Pad から1つをセッション開始時にランダムに選んで固定していたが、
   **全テイクを同時にループ再生し、それぞれの音量を周期の異なる正弦LFO（43/59/71/83秒）で
   独立にドリフトさせる**方式に変更した。全テイクは同一キー/スケールで作られているため、
   どの混合比になっても不協和にならない。t=0 なら Pad Ensemble、離散的な「コードチェンジ」は
   一切発生しない、常に連続的な音色/和声の移ろいになる。
2. **キックドラムのグルーヴ**（`scripts/generate-placeholder-audio.mjs` の `generatePulse`）:
   従来の固定周波数クリック音を、周波数が急速に下降する膜鳴楽器的な「ドスン」という
   キックドラムらしい音に変更した（`toneStartHz→toneEndHz` を指数的に下降させる位相積分）。
   Work / Move にはオフビートの軽いハイハットを追加し、活動のリズム感を強めた
   （Study は複雑思考向けのため追加しない）。

### 調べたこと（実装前に文献調査した内容の要約）
- **Brian Eno のアンビエント設計原則**（*Music for Airports* ライナーノーツ）: "Ambient Music
  must be as ignorable as it is interesting"。Eno は長さの異なるテープループを同時に回し
  続けることで、離散的な「切り替わり」なしに組み合わせが無限に変化する技法
  （フェイジング）を使った。Pad Ensemble はこの技法を音量LFOで再現したもの
- **和声の予測可能性と注意（ERAN研究）**: 予測を外れたコード進行は聴取後150–200msで
  ERAN（前頭部陰性電位）という「予測誤差」の脳波反応を引き起こす。これは**離散的な
  和声変化ほど注意を強く引く**ことを示唆する。したがって「コードチェンジ」ではなく
  「連続的なドリフト」を選んだ
- **Sun (2025), Behavioral Sciences**: Mozart K448（構造的予測可能性の高い楽曲）は作業フローを
  有意に向上させた一方、高覚醒・急激なリズム/ダイナミクス変化を持つ楽曲は作業フローを
  **阻害**した。低覚醒音楽の特徴は「一定のテンポ・和声的複雑さの最小化」
- **Georgetown大学の "work flow" 音楽研究**: 集中を助ける音楽は「歌詞なし・急激な
  メロディ変化なし・安定した進行」が特徴。同研究では、理論上フォーカスに適しそうな
  ambient/lofi が必ずしも気分を改善しなかった点も示された（万能ではない）
- **リズム性聴覚刺激（RAS）と運動同調**: 一定のリズム刺激に運動系が同調する現象は
  神経科学的に確立されている（Thaut ら）。ただし証拠の中心は歩行リハビリ等の運動療法で、
  デスクワークの生産性への直接的な効果は限定的にしか確認されていない
- **Brain.fm の手法**（企業の公開情報）: 「メロディを持たない」「急激な音量変化をしない」
  リズム変調を主軸に置く。ボーカルなし・強いフックなしという設計は既存方針と一致

### 影響
- `packages/audio-engine/src/phase-graph.ts`: `addPadEnsemble` を追加、`dispose()` で
  LFO発振器・補助ノードも解放するようにした
- `packages/audio-engine/src/phase-graph.offline.test.ts`（新規）: `OfflineAudioContext` で
  Pad Ensemble が実際にクリッピングなく鳴ることを検証
- `scripts/generate-placeholder-audio.mjs`: `generatePulse` をピッチドロップ式キック合成 +
  任意のオフビートハイハットに拡張。Study/Work/Move の pulse 素材を再生成
- Sustain区間で「ほぼ変化しない」という ADR-004 以来の原則そのものは崩していない
  （Pad Ensemble のドリフトは**連続的**であり、`tick()` が動かす Pad 全体の音量弧とは独立）

### 却下した代替案
- **明示的なコード進行（I→IV→V→I 等のケーデンス）を Pad に組み込む**: ERAN研究が示す通り
  離散的な和声変化は注意を引きやすく、特にケーデンス（ドミナント→トニック）は
  「解決」を求める心理的圧力を生む。Endel Science の "restorative not entertaining" とも
  矛盾するため見送った
- **ドラムキットのフル実装（スネア・フィル等）**: 文献はどれも「low rhythmic complexity」
  「no sudden changes」を支持しており、シンコペーションやフィルはむしろ逆効果になりうる。
  キック＋オフビートハイハットのみの最小構成に留めた

---

## ADR-007: Study と Work を用途別にブラッシュアップする（読書 vs PC作業・創作）

### 決定
ユーザーからの用途の明確化を受け、Study と Work を次のように差別化した。

- **Study**: 「本を読む・参考書と向き合う」学習を想定。ピンクノイズにさらに軽いローパス
  （4600Hz）をかけて高域のシャリつきを削り、Pad/Cell/Cue 全体の `lowPassHz` sustain を
  6000Hz→5400Hz に下げた。音色をより暗め（低覚醒）に寄せることで「静かな図書室」の
  印象を強めている
- **Work**: 「PC作業・仕事」に加えて「作曲やライティングなどの創造的作業」も想定。
  - Pad に木質楽器/弦楽器のボディ共鳴を模した帯域（700Hz付近）を持ち上げ、Endel の
    "Deep Work"（"smooth synthesized string, keyboard and wood notes"）が描く温かい
    楽器的質感に寄せた
  - Texture を「オフィスの空調ハム」（`hum`）から「木質の部屋に包まれる」低〜中域の
    ノイズ（`room`、250–2200Hz帯域）に置き換えた
  - `reverbWet` を sustain 0.16→0.20 に増やし、Endel の "immersive background harmony"
    に寄せて没入感を足した
  - Pulse のオフビートハイハットを控えめに（`hatGain` 0.09→0.06）、`cellDensity` も
    sustain 0.13→0.11 に下げた。作曲・ライティングは言語/音楽処理そのものを行う
    タスクであり、リズム/装飾音の主張が強いと自分の思考と競合しうるため

### 調べたこと
- **Endel の公式カテゴリ分け**（endel.io）: "Focus" は「問題解決・創造的・精緻・身体的
  タスク」向け、"Deep Work" は「フロー状態に入りタスクを片付ける」向けで
  "smooth synthesized string, keyboard and wood notes, slow tempo, immersive background
  harmony" と説明されている。"Create" は「創造的なフローを見つける」ためのカテゴリ
- **言語処理を伴う創造的作業（ライティング）への示唆**: 「読解のような言語処理を要する
  タスクは（アイデア出しのような）他の創造的タスクほど背景音楽の恩恵を受けない。
  歌詞は言語処理中枢と競合する」という報告があり、**ライティングは「創造的」であっても
  読解と同様に音楽的主張の強い刺激を避けるべき**と判断した
- **音色（timbre）の感情価研究**: 明るい音色（高いスペクトル重心）ほど緊張性覚醒
  （tension arousal）・エネルギー覚醒（energy arousal）が高くなり、低いスペクトル傾斜
  ＋強い低次倍音は肯定的な感情価（valence）と結びつく。Study はさらに暗め（低覚醒・
  高valence）に、Work はやや明るいが刺々しくない範囲に、という差別化の根拠にした
- **音楽家に対する背景音楽の逆効果**（docs/research/focus-sound-literature-review-gemini.md / BGM文献調査
  で既出）: 自分が演奏・作曲する楽器がメインの音楽を聴くと、非音楽家より成績が著しく
  低下する報告がある。Work のリズム/装飾音を控えめにした直接の根拠

### 影響
- `scripts/generate-placeholder-audio.mjs`: `generatePad` に `bodyResonanceHz`/
  `bodyResonanceGain`、`generateTexture` に `warmLowpassHz` と `"room"` kind を追加
- `apps/web/public/packs.json` / `packages/audio-engine/src/automation.ts`:
  Study の `lowPassHz`、Work の `reverbWet`/`cellDensity`/texture takes を更新
- `audio/work/texture_hum.wav` を `audio/work/texture_room.wav` に置き換え（ファイル名変更）

---

## ADR-008: Relax / Sleep を再構築する（音楽性の付与 + Sleep のフェーズ分け）

### 決定
`docs/research/relax-sleep-sound-chatgpt.md`（Cochraneレビュー・メタ解析中心の文献調査）に基づき、
Relax と Sleep を全面的に再設計した。

1. **両テーマに「音楽性」を付与**: Study/Work/Move の打楽器的なキック（`generatePulse`）とは
   別に、スケール内の音程を辿る柔らかい旋律フレーズを奏でる新しい合成関数
   `generateArpeggioPulse` を実装し、Relax（D Lydian, 70bpm, 7拍で山なりに登り降りする
   フレーズ）と Sleep（D Aeolian の低い register, 60bpm, 8拍中3拍だけ鳴る疎らな短三和音）に
   `pulse` レイヤーとして追加した。フェルトピアノ/マレット的な音色（`generateOneShot` と同じ
   倍音構成）で、Study/Work/Move の「作業的な拍」とは明確にキャラクターを分けている
2. **Sleep のフェーズ分け（入眠 → 深い睡眠）**: ユーザー要望「最初40分は入眠用の音、
   その後は睡眠をより深くするための音」を実装した。ただし文献の核心的な知見
   （後述）を踏まえ、「40分後に**別の音**へ切り替える」のではなく、**継続的な刺激から
   なめらかに遠ざかり、静寂に近づいていく**設計にした
   （`packages/audio-engine/src/automation.ts` の `sleepAutomation` を参照）
3. **Home のフリー再生における実時間ベースの t 進行**（`apps/web/lib/soundscapeRuntime.ts`）:
   Sleep は一晩中つけっぱなしにする使い方が現実的なため、「最初40分」を実時間で成立させる
   必要がある。フリー再生は本来 t を固定して鳴らし続ける設計（`FREEPLAY_T = 0.45`）だが、
   Sleep のときだけ経過時間を積算し、100分を仮想セッション長として t を進める
   （40分がちょうど t=0.4 に一致する）。バックグラウンドタブでこの更新ループの発火間隔が
   間延びしても、実時刻の差分を積算する方式なので実時間からズレない

### 調べたこと
- **Cochraneレビュー（Jespersen 2022 ほか）**: 就寝前 25–50分/日のリラックス音楽聴取で
  睡眠の質（PSQI）が中程度のエビデンスで改善。テンポは60–85BPM程度が中心
- **就寝中の連続ノイズへの警鐘（最重要の知見）**: 基礎研究（Basner 2026）で、ピンクノイズ
  50dBの継続再生により**REM睡眠が平均約19分短縮**したという逆効果が報告されている。
  白色/ピンクノイズ機の連続使用は「エビデンスが低く、逆にREMや深睡眠を減少させる
  可能性が指摘されている」。レポートの推奨は「就寝後はタイマーで停止し、静寂や
  耳栓で深睡眠に移行する」
- **推奨パラメータ**: リラックス用BGMはテンポ60–80BPM、柔らかく単純な旋律、歌詞なし、
  音量は静かめ（40–50dB程度）。反復性や予測可能性が高いリズムが安定感を高める
- 上記2点目が「40分以降のフェーズ」の設計方針を決定づけた: エビデンスが支持するのは
  「深く眠るための特別な音」ではなく「刺激を減らしていくこと」である

### 影響
- `scripts/generate-placeholder-audio.mjs`: `generateArpeggioPulse` を追加。Relax/Sleep に
  `pulse` レイヤー（`bpm`: Relax=70, Sleep=60）を新設
- `apps/web/public/packs.json` / `packages/audio-engine/src/automation.ts`:
  `relaxAutomation`/`sleepAutomation` を全面改訂。`sleepAutomation` は t=0.05–0.35 を
  「Onset（入眠）」、t=0.42 以降を「Deep（深い睡眠）」とし、pad/texture/pulse/cellDensity を
  段階的に下げ、reverbWet を大きく・lowPassHz を暗くしていく。t=1.0 以降は t が
  `Math.min(1, ...)` で頭打ちになるため、その最も静かな状態を一晩中保持し続ける設計にした
  （Relax のような「re-engage」で音量を戻す演出はあえて入れていない）
- `apps/web/lib/soundscapeRuntime.ts`: `SLEEP_VIRTUAL_DURATION_SEC`（100分）を追加。
  フリー再生が Sleep のときだけ実経過時間で t を進めるようにした

### 却下した代替案
- **40分時点で「深い睡眠用の全く別の音源」にクロスフェードする**: 文献の核心的な懸念
  （継続的なノイズ曝露がREM睡眠を妨げうる）に反するため見送った。「別の音を足す」のではなく
  「刺激を減らす」方向で設計した
- **Sleep のフリー再生も他テーマと同じ固定 t=0.45 のまま**: これだと「最初40分」が
  実時間として一切成立しない（ユーザー要望を満たせない）ため、Sleep 限定で実時間ベースの
  t 進行を新設した

---

## ADR-009: 全テーマを Endel の設計方針に沿って作り直す（Study/Work の差別化、Move の別物化、Relax の不快感修正）

### 決定
ユーザーから3点の指摘を受け、5テーマすべてを「今までの音は考慮せず」再設計した。

1. **Study と Work の違いが分かりにくい**: 旧設計はどちらも「打楽器的な pulse を持つ、
   ゆっくりイーズイン→サステイン→テーパーの弧」というほぼ同じ構造で、テンポと音色の
   ニュアンスしか差が無かった。→ **Study は Study/Work/Move の中で唯一「拍」を持たない
   テーマに変更**（Pulse は8拍に1音だけ鳴る極めて疎らな一音）。Work は逆に「規則的な拍が
   集中の持続を助ける」という Endel の方針を明確に採用し、キック+ハイハットに加えて
   短いコンピング動機（`generateGroovePulse`）を重ねて音楽性を足した
2. **Move は筋トレ・運動用で他とは活動内容がまったく違うので、リズミカルな別物にすべき**:
   旧設計は Study/Work と同じ弧をテンポ(120bpm)だけ変えて流用していた。→ **弧の構造から
   作り替えた**。t=0 からほぼフルゲインで始まる「Drop-in」、キック+スネア(2・4拍目)+
   ハイハットの実際のドラムパターン（`generateWorkoutGroove`）、Pad 自体も拍ごとに
   ダッキングする「ポンピング」エンベロープ（`generatePad` の `pumpBpm`）、ほぼドライな
   リバーブ(0.05–0.12)、128bpm（一般的なワークアウト楽曲のテンポ帯）に変更
3. **Relax で「ずっと上下する反響しているような音」が不快**: 調査の結果、`phase-graph.ts` の
   `addPadEnsemble`（ADR-006）が原因と特定した。Pad の複数テイクを和声ドリフト用LFOで
   ブレンドする仕組みで、旧 `PAD_DRIFT_DEPTH=0.45`（baseline 0.55 との合成で各テイクの
   音量が 0.10〜1.00 と10倍振れる）が、Relax の高い `reverbWet`（0.45–0.65）と組み合わさり、
   「リバーブが呼吸するように膨らんでは萎む」トレモロ様のポンピングとして知覚されていた。
   → **`PAD_DRIFT_DEPTH` を 0.45→0.18 に縮小**（全テーマに影響する根本原因の修正）。
   加えて Relax・Sleep 個別の `reverbWet`/`pad`/`texture` の振れ幅も抑え、二重に対策した

Endel の公開設計方針（endel.io/science, endel.io/focus, endel.io/activity, endel.io/relax）を
テーマごとに参照し、「拍の有無・性格」を軸に役割を整理した（詳細は `04_SOUND_ENGINE.md` §4）。

| テーマ | Endel的な位置づけ | Pulse の性格 |
|---|---|---|
| Study | Read — 規則的な拍を持たない没入 | 拍ではなく極めて疎らな一音（`generateArpeggioPulse` を8拍中1音に間引き） |
| Work | Deep Work — 規則的な拍が集中の持続を助ける | キック+ハイハット+短いコンピング動機（新設 `generateGroovePulse`） |
| Move | Activity — 運動のケイデンスに同調する別物のリズム | キック+スネア+ハイハットの実ドラムパターン（新設 `generateWorkoutGroove`） |
| Relax | Relax — "simple sound structures... no beat... easy to process" | 柔らかい旋律のみ（ADR-008 を維持、振れ幅を縮小） |
| Sleep | Sleep — 入眠→深い睡眠で静寂に近づく | Onset のみ柔らかい旋律（ADR-008 を維持、振れ幅を縮小） |

### 調べたこと
- **endel.io/science**: 「規則的な拍が長時間の集中を助けるというのは何世紀も前から知られており、
  Endel の生産性向けサウンドスケープすべての基盤になっている」
- **endel.io/focus**: Focus は「問題解決・創造的・精緻・身体的タスク」向けの総称カテゴリで、
  "Deep Work" はその中でも「フロー状態に入りタスクを片付ける」ためのシナリオ
- **endel.io/relax**: "Relax soundscapes don't include beats or complex sound textures —
  they're designed to soothe with simple sounds that are easy for your brain to process"。
  「拍を持たない」がプロダクトとして明言されている点が、今回の Study/Relax の再設計を裏付けた
- **endel.io/activity**: Activity（旧 On-the-Go）は加速度センサー等でケイデンスを検出し、
  歩行/ランニングのリズムに合わせて打楽器を加える。運動は「歩数に合わせて音が今すぐ動く」
  文脈であり、他テーマのような穏やかなイーズインは合わないと判断した
- **バグ調査（Relax の不快感）**: `packages/audio-engine/src/phase-graph.ts` を読み、
  `breathLfoHz`/`breathDepth`（`PhaseAutomation` の一部）が実は `phase-graph.ts` の
  どこからも参照されていない**死んだフィールド**だと判明した。実際に「呼吸」のように
  音量を揺らしていたのは `addPadEnsemble` の LFO（ADR-006）であり、当初の想定（`breathLfoHz`
  が何らかの呼吸効果を作っている）は誤りだった。この調査結果を受けて `breathLfoHz`/
  `breathDepth` は `PhaseAutomation` 型・`packs.json`・`automation.ts` から削除した
  （存在しない効果を示唆するフィールドを残すより、実際に効いている `PAD_DRIFT_DEPTH` を
  直接修正する方が正確で保守しやすいと判断）

### 影響
- `packages/audio-engine/src/phase-graph.ts`: `PAD_DRIFT_DEPTH` 0.45→0.18、`PAD_DRIFT_BASELINE`
  0.55→0.66、`PAD_DRIFT_PERIODS_SEC` を長め化
- `packages/audio-engine/src/types.ts`: `PhaseAutomation` から `breathLfoHz`/`breathDepth` を削除
- `packages/audio-engine/src/automation.ts`: 5テーマすべてのキーフレームを全面改訂
- `apps/web/public/packs.json`: 同上。Move の `bpm` 120→128、Relax の `bpm` 70→64、
  それぞれの pulse/pad `loopSeconds` を再計算（`isPulseLoopAligned` で検証済み）
- `scripts/generate-placeholder-audio.mjs`: `generatePad` に `pumpBpm` オプションを追加、
  `generateGroovePulse`（Work）・`generateWorkoutGroove`（Move）を新設。Study の Pulse 呼び出しを
  `generatePulse` から `generateArpeggioPulse`（疎らな設定）に変更
- 音源再生成対象: `audio/study/{pad_02,pulse_01,pulse_02}.wav`、`audio/work/{pulse_01,pulse_02}.wav`、
  `audio/move/{pad_01,pad_02,pulse_01,pulse_02}.wav`、`audio/relax/{pulse_01,pulse_02}.wav`
  （`docs/ASSET_LICENSES.md` の該当行を更新）
- `apps/web/lib/soundThemes.ts`: Move の subtitles を「軽い運動」寄りの文言から
  「筋トレ・運動」寄りの文言（Strength Training / Cardio Drive / Workout Pulse / Power Hour）に変更
- `packages/audio-engine/src/phase-graph.offline.test.ts`,
  `packages/audio-engine/src/automation.test.ts`: `breathLfoHz`/`breathDepth` 削除と
  Study の pulse 期待値変更に追従

### 却下した代替案
- **`breathLfoHz`/`breathDepth` を実際に配線して活かす**: 死んだフィールドを活用する案も
  検討したが、Relax の不快感の直接原因は Pad Ensemble のドリフトであり、そこに追加で
  音量LFOを足すとさらに複雑になり再発リスクが増える。フィールド自体を削除し、
  `PAD_DRIFT_DEPTH` を直接修正する方が単純で安全と判断した
- **Move のテンポを 120bpm のまま据え置く**: 一般的なワークアウト楽曲のテンポ帯（house/pop
  系で124–128bpm）を踏まえ、128bpmへ変更した。pulse/pad の `loopSeconds` はすべて128bpmの
  拍に整数個収まる値へ再計算した
- **Study にも何らかの拍を残す**: endel.io/relax が「拍を持たない」を明言している以上、
  Study（読解という言語処理タスク）にも同じ理屈が当てはまると判断し、拍を完全に排除した

---

## ADR-010: 天気・時間帯・経過時間で音を状況適応させる（Endel的な自動性）

### 決定
Endel の「状況（位置・時刻・天気）に応じてサウンドスケープが変わる」という中核体験を、
`docs/research/environment-adaptive-sound.md`（聴覚刺激と認知パフォーマンス/リラクゼーションの文献調査）を
踏まえて実装した。3つの軸を独立に計算し、合成して各テーマの `PhaseAutomation` に
**控えめな補正**として上乗せする:

1. **天気**（ブラウザの Geolocation API + [Open-Meteo](https://open-meteo.com/)、APIキー不要）
2. **時間帯**（朝 5–11時 / 昼 11–17時 / 晩 17–5時、端末のローカル時刻）
3. **音を流している経過時間**（Pomodoroのフェーズをまたいで積算する、セッションの長さ）

いずれの変化も「ゆっくりなだらかに切り替える」（指数平滑化、τ=90秒）。

**音源は新規に作らず、既存のセットのみを使う**という要求に対し、天気を4カテゴリ
（clear/cloudy/rain/snow）に単純化した上で、次のように**既存パラメータと既存アセットのみ**で表現した:

| 軸 | 実装方法 | 新規音源 |
|---|---|---|
| 天気=rain | 既存の `audio/relax/texture_rain.wav`（Wikimedia Commons, Public Domain）を全テーマ共通のオーバーレイ層として薄く重ねる | なし（既存アセットの再利用） |
| 天気=snow | 積雪の遮音効果を模し、`lowPassFactor` を大きく下げて「こもった静かな世界」にする | なし（既存パラメータのみ） |
| 天気=clear/cloudy | `lowPassFactor` の微調整のみ | なし |
| 時間帯 | 朝=明るく、晩=暗く暖かく、昼=無補正。`lowPassFactor`/`reverbWetDelta`/`padGain` の微調整のみ | なし |
| 経過時間 | 45分を超えたら3時間かけて `pulseGain`/`cellDensityFactor` を最大18%緩やかに絞る（聴取疲労対策） | なし |

### 「気分に合わせる」の解釈
ユーザーからの明示的な指摘: **「気分に合わせるというのは、気分に似た音を流すことではなく、
そのサウンドで行うタスクに適切な心理状態に導くこと」**。これを設計の中心原則にした。
たとえば雨の日でも Study/Work のリズム・密度を大きく削って「しんみりした音」にはしない
（読解・作業に必要な覚醒度を壊すため）。そのため:

- 各軸の効果量はいずれも小さい（目安 ±20%以内）に抑えた
- 3軸を合成しても安全域を外れないよう `environment.ts` の `clampModifier` で最終的にクランプする
  （`padGain`∈[0.85,1.15]、`pulseGain`/`cellDensityFactor`∈[0.7〜0.75, 1.15〜1.2]、
  `lowPassFactor`∈[0.65,1.25]、`reverbWetDelta`∈[-0.05,0.08]、`rainOverlayGain`∈[0,0.2]）
- 天気・時間帯オーバーレイは常に「彩り」（lowPass・reverb・微量のゲイン）であり、
  テーマの核となる音色・楽器編成・リズム構造（ADR-009）自体は一切変更しない

### 調べたこと
- `docs/research/environment-adaptive-sound.md`（聴覚刺激の包括的文献調査）: 「覚醒・気分仮説」
  「確率共鳴」「無関連発話効果」など、本プロジェクトが既に採用している設計原則
  （ノイズ色の使い分け、拍の有無、歌詞なし等）の理論的裏付けを再確認した。
  この文献自体は「天気」を直接扱っていないが、「継続的な刺激への曝露は過剰になりうる」
  という論旨（確率共鳴のスイートスポット、処理流暢性の低下、CLASの睡眠保護目的の減衰など）を、
  「経過時間による緩やかな刺激の減衰」という設計に応用した
- **Open-Meteo**: APIキー不要・無料・商用利用可（CC BY 4.0 でデータ提供、コード添付は必須ではないが
  クレジット表示が望ましいとされる）の天気API。`docs/ASSET_LICENSES.md` に外部API利用として記録
- **Endel の実際の挙動**（`01_ENDEL_RESEARCH.md`、endel.io/science）: 「時刻・天気・場所によって
  同じモードでも異なる音になる」という説明があり、これが「Endelのように」という要望の核心

### 影響
- `packages/audio-engine/src/environment.ts`（新規）: `WeatherCategory`/`TimeOfDay`/
  `EnvironmentContext`/`EnvironmentModifier` と、`weatherCategoryFromWmoCode`/`timeOfDayFor`/
  `targetEnvironmentModifier`/`smoothEnvironment` の純粋関数群。副作用ゼロ、Date注入可能
- `packages/audio-engine/src/phase-graph.ts`: `tick(t, now, environment)` が
  pad/texture/pulse/lowPassHz/reverbWet に補正を適用。全テーマ共通の雨オーバーレイ層
  （`addEnvironmentRainLayer`）を追加。`currentCellDensity()` も補正後の値を返す
- `packages/audio-engine/src/engine.ts`: `tick(t, environment?)` で下流に伝搬するだけ
  （`environment` 省略時は `NEUTRAL_ENVIRONMENT` で従来どおり無補正）
- `apps/web/lib/environment.ts`（新規）: Geolocation + Open-Meteo による天気取得。
  失敗（許可拒否・オフライン・API障害）時は例外を投げず `null` を返し、時間帯のみへ自然に
  フォールバックする
- `apps/web/lib/soundscapeRuntime.ts`: 天気を30分ごとに再取得、`sessionElapsedSec` を
  Pomodoroのフェーズ・Home のテーマ切り替えをまたいで積算（完全停止でリセット）、
  `smoothEnvironment` で毎ティックなだらかに近づけてから `engine.tick()` に渡す
- 新規音源: なし（既存の `audio/relax/texture_rain.wav` を全テーマで再利用）

### 却下した代替案
- **天気ごとに専用の音源セットを新規収録・生成する**: 「音は作る前に条件に合うものを探し、
  なるべく既存のセットを用いる」という明示的な要求に反する。天気は「彩り」であり
  「別のテーマ」ではないと判断した
- **雪の日に専用の雪音源を探す/作る**: 雪はそもそも音を立てない（降雪音の録音は非現実的）。
  「積雪が周囲の音を吸収して静かになる」という物理現象を `lowPassFactor` で表現する方が
  理にかなっており、新規音源も不要になった
- **サーバーサイドで天気を取得してSSRに埋め込む**: `docs/CLAUDE.md` の方針
  （SSR/API Routesを使わない、完全クライアントサイド）に反するため見送った。
  クライアント側の Geolocation + fetch で完結させた
- **位置情報の許可が得られない場合にIPアドレスから大まかな位置を推定する**: 追加の外部サービスへの
  依存とプライバシー上の懸念が増えるため見送った。取得できなければ潔く「時間帯のみ」に
  フォールバックする設計にした

---

## 併用する Web API

| API | 用途 | Phase |
|---|---|---|
| Media Session API | デスクトップのメディアキー、OSのメディアコントロール連携 | 3 |
| Page Visibility API | 復帰時の経過時間再計算とフェーズ再同期 | 1 |
| Screen Wake Lock API | 集中中に画面を消させない | 3 |
| Service Worker + Cache Storage | 音源キャッシュとオフライン動作（F-12） | 3 |
| Notification API | フェーズ切替通知 | 3 |

---

## 技術スタック

| 領域 | 採用 |
|---|---|
| フレームワーク | Next.js 15 (App Router, `output: 'export'`) |
| 言語 | TypeScript（`strict: true`） |
| 音声 | Web Audio API（素） |
| 状態管理 | Zustand（軽量・クライアント専用でNext.jsと相性が良い） |
| スタイル | Tailwind CSS |
| 永続化 | IndexedDB（`idb` ラッパ）+ localStorage（設定） |
| テスト | Vitest（+ `OfflineAudioContext` を使った音の検証） |
| Lint / Format | ESLint + Prettier |
| モノレポ | pnpm workspaces（`packages/` を切るため） |

> Zustand を推す理由: このアプリの状態は「タイマー」と「設定」だけで、サーバ状態がない。
> Redux は過剰、Context は再レンダリングの制御が面倒。異論があれば Jotai でも良い。

---

## ディレクトリ構成

```
kairos/  (リポジトリルート)
├─ CLAUDE.md
├─ docs/                        # 本ドキュメント群 + ASSET_LICENSES.md
├─ apps/
│   └─ web/                     # Next.js アプリ
│       ├─ app/
│       │   ├─ layout.tsx
│       │   ├─ page.tsx         # タイマー画面
│       │   ├─ settings/page.tsx
│       │   └─ stats/page.tsx
│       ├─ components/
│       ├─ hooks/               # useTimer, useSoundscape, useWakeLock
│       ├─ public/
│       │   ├─ audio/           # ステム素材
│       │   ├─ ir/              # インパルス応答
│       │   └─ packs.json
│       └─ next.config.js
└─ packages/
    ├─ core/                    # タイマー状態機械。純粋TS、依存ゼロ
    │   └─ src/{preset,timer-state,transitions}.ts
    └─ audio-engine/            # サウンドエンジン。Web Audio に対して書く純粋TS
        └─ src/
            ├─ engine.ts            # SoundscapeEngine
            ├─ automation.ts        # PhaseAutomation（純粋関数）
            ├─ cell-scheduler.ts    # 確率的スケジューラ（純粋関数 + PRNG）
            ├─ loop-manager.ts      # クロスフェードループ
            ├─ crossfader.ts        # フェーズ間移行
            ├─ scheduler.worker.ts  # スロットリング回避ティッカー
            └─ types.ts
```

### 依存の方向
```
apps/web  →  packages/audio-engine  →  Web Audio API
apps/web  →  packages/core          →  （何にも依存しない）
```

- `packages/core` は **React にも DOM にも依存しない**。`Date` すら注入する
- `packages/audio-engine` は **React に依存しない**。Web Audio のみ
- この分離により、`core` は Node 上で、`audio-engine` は `OfflineAudioContext` でテストできる
- 将来のネイティブ移植は `apps/mobile` を足して両 package を再利用するだけになる

### エンジンとUIの結合点
```
useTimer (React) ──(progress t を 10Hz で通知)──► SoundscapeEngine.tick(t)
                 └─(phase 変更)─────────────────► SoundscapeEngine.transitionTo()
```
エンジンは**時間を知りません**。正規化された進捗 `t ∈ [0,1]` とフェーズ種別だけを受け取ります。
これにより 25分でも 50分でも同一ロジックが動きます。

---

## 却下した構成（記録）

| 案 | 却下理由 |
|---|---|
| Flutter + flutter_soloud | 初版の推奨案。全6プラットフォーム対応と成熟した音声ライブラリが利点だったが、PCメイン・Web最優先という方針では Dart の学習コストに見合わない。Endel 自身もネイティブ実装であり、Flutter が「Endelに近い」わけでもない |
| Expo + react-native-audio-api を主軸 | モバイル優先なら最有力。Web最優先の現方針では遠回り。ただし engine パッケージはこの移行を想定した設計にしてある |
| Tauri でデスクトップアプリ化 | PCブラウザで完結するため不要。バンドルとリリースの手間が増えるだけ |
| Next.js を SSR ありで使う | 完全クライアントサイドのオフラインアプリなのでサーバ機能が無意味 |
