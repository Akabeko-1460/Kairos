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

`docs/deep-research-report_chatGPT.md` と `集中力を高める音の文献調査_gemini.md` の
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
- **音楽家に対する背景音楽の逆効果**（集中力を高める音の文献調査_gemini.md / BGM文献調査
  で既出）: 自分が演奏・作曲する楽器がメインの音楽を聴くと、非音楽家より成績が著しく
  低下する報告がある。Work のリズム/装飾音を控えめにした直接の根拠

### 影響
- `scripts/generate-placeholder-audio.mjs`: `generatePad` に `bodyResonanceHz`/
  `bodyResonanceGain`、`generateTexture` に `warmLowpassHz` と `"room"` kind を追加
- `apps/web/public/packs.json` / `packages/audio-engine/src/automation.ts`:
  Study の `lowPassHz`、Work の `reverbWet`/`cellDensity`/texture takes を更新
- `audio/work/texture_hum.wav` を `audio/work/texture_room.wav` に置き換え（ファイル名変更）

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
