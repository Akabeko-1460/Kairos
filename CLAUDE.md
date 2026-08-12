# CLAUDE.md — Claude Code への作業指示（rev.2）

このファイルを最初に読んでください。詳細仕様は `docs/` 配下にあります。

---

## プロジェクト

**Kairos** — ポモドーロタイマーと生成BGMを組み合わせた **Webアプリ**。
集中フェーズ（25分/50分）と休憩フェーズ（5分/10分）で異なるサウンドスケープが自動で切り替わり、
フェーズ内でも時間経過に応じて音が変化していく。

**技術スタック:** Next.js 15 (App Router) / React 19 / TypeScript / **素の Web Audio API** / Zustand / Tailwind
**ターゲット:** PC ブラウザが主。モバイルは PWA。ネイティブアプリは作らない（Phase 4 で検討）

---

## 最初に読む順番

1. `docs/02_SPEC.md` — 何を作るか
2. `docs/03_ARCHITECTURE.md` — どう組むか、なぜ Web Audio を直に使うか
3. `docs/04_SOUND_ENGINE.md` — **音の設計。ここが本体**
4. `docs/05_IMPLEMENTATION_PLAN.md` — Phase 0 から着手する

`docs/01_ENDEL_RESEARCH.md` は設計判断の根拠。迷ったら参照してください。

---

## 作業の進め方

- **Phase 0 の3つのスパイクを最優先で実施すること。**
  (A) 等パワークロスフェード、(B) バックグラウンドタブ耐性、(C) メモリ実測。
  ここが破綻すると設計全体を見直す必要があるため、UI や他の機能より先に確かめる。
- 特に (C) の結果は音素材の長さ・チャンネル数を決めるので、素材制作より前に必ず出す。
- 各 Phase は「動作するアプリ」で終わらせる。機能を横断的に半端な状態で残さない。
- 大きな設計判断を変更する場合は、`docs/03_ARCHITECTURE.md` に ADR として追記してから進める。
- 不明点があれば実装を進める前に確認する。特に `README.md` 末尾の「未確定事項」に該当するもの。

---

## コーディング規約

### 構造
- `docs/03_ARCHITECTURE.md` のディレクトリ構成に従う
- **`packages/core` は React にも DOM にも依存させない。** `Date` すら注入する
- **`packages/audio-engine` は React に依存させない。** Web Audio API のみ
- タイマーの状態遷移、オートメーション曲線、Cell スケジューラは**副作用ゼロの純粋関数**として書く
- リミッタは**インターフェースで抽象化する**。将来のネイティブ移植時に `DynamicsCompressorNode` が
  使えず `WaveShaperNode` で代替する必要があるため（`04_SOUND_ENGINE.md` §9）

### Next.js 固有
- すべて `'use client'`。SSR / RSC / Server Actions / API Routes は使わない
- `next.config.js` に `output: 'export'`
- **`window` / `AudioContext` を参照するコードが SSR 時に評価されないようにする。**
  動的 import か `useEffect` 内での初期化を徹底する

### スタイル
- TypeScript は `strict: true`。`any` 禁止
- 早期リターンを優先し、ネストを浅く保つ
- 命名は意図を表す。`data` `info` `temp` `handle` のような曖昧な名前は使わない
- 単位を名前に含める: `fadeSec` `loopSeconds` `lowPassHz` `bpm` `densityPerSec`
- 真偽値は肯定形で: `isRunning`（`isNotRunning` にしない）
- コメントは「なぜそうしたか」を書く。「何をしているか」はコードで表現する
  - 良い例: `// 線形フェードだと中間で音圧が落ちるため等パワーカーブを使う`
  - 悪い例: `// gain を計算する`

### テスト
- `packages/core` と `packages/audio-engine` の純粋関数はユニットテスト必須（目標カバレッジ 90%）
- 時刻に依存するロジックは `Clock` を注入してテストで固定する（`Date.now()` を直接呼ばない）
- `CellScheduler` は同一シードで同一系列を返すことをテストで保証する
- pulse 素材の `loopSeconds × bpm / 60` が整数であることをテストで保証する
- **`OfflineAudioContext` を使って、クロスフェード区間のRMSとクリッピングを自動検証する**
- 音の質は自動テストで検証できない。実聴を必ず行い、結果を記録する

### コミット
- Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`)
- 1コミット1目的。Phase の区切りでタグを切る

---

## この実装で特に間違えやすい点

| 項目 | 正しいやり方 |
|---|---|
| **バックグラウンドタブ** | 音のスケジューリングを `setTimeout` に依存させない。**Web Worker のティッカー**で駆動し、時刻基準は `AudioContext.currentTime`。常に2〜3秒先まで予約する |
| **タイマーの経過計算** | 絶対時刻ベース。`Date.now() - phaseStartedAt - accumulatedPause` で毎回再計算。`setInterval` の回数を数えない |
| **AudioContext の初期化** | 必ず**ユーザー操作（Startボタン）を起点に** `new AudioContext()` と `resume()` を行う。自動再生ポリシー |
| **クロスフェード** | **等パワーカーブ**（cos/sin）。線形だと中間で音圧の谷ができる |
| **`setValueCurveAtTime`** | 実行中の AudioParam に他の予約を入れると例外。クロスフェード中はその層のオートメーションを止める |
| **リバーブ** | `ConvolverNode` を直列に入れない。**send/return 構成**にして dry と混ぜる |
| **メモリ** | `decodeAudioData` の結果は非圧縮 Float32。60秒ステレオ44.1kHz ≈ 21MB。ループは32秒以下、Texture はモノラル |
| **フェーズ切替のタイミング** | タイマーの切替より**音を先に**動かす（t≈0.985 から移行開始） |
| **エンジンへの入力** | 秒数ではなく**正規化された t (0.0–1.0)** を渡す。これで25分でも50分でも同じロジックが動く |
| **Cell の初回発火** | フェーズ開始から最低5秒のオフセットを入れる（開始直後の発火は唐突） |
| **音声フォーマット** | OGG Vorbis を使う。MP3 は避ける |

---

## 禁止事項

- ❌ Endel の音源・ロゴ・商標・UI意匠を複製・流用すること
- ❌ アプリ名やサイト表記・マーケティングに "Endel" を使用すること
- ❌ ライセンスを確認していない音源・インパルス応答をリポジトリに追加すること
  - 素材を追加したら**必ず** `docs/ASSET_LICENSES.md` に出所・生成サービス・ライセンス条件を記録する
  - AI生成サービスの無料プランは商用利用不可の場合がある。確認前の同梱は禁止
- ❌ ボーカル入り・明確なメロディを持つ素材を BGM 素材として使うこと（集中を妨げるため）
- ❌ 「集中力が◯倍になる」等の健康・効果訴求をUIやサイト説明に書くこと（自前のエビデンスがないため）
- ❌ `packages/core` に React / DOM への import を追加すること
- ❌ `packages/audio-engine` に React への import を追加すること
- ❌ Tone.js / Howler.js など音声ライブラリを導入すること（ADR-003 の判断を覆す場合は先に相談）
- ❌ ユーザーの許可なく解析ツール・トラッカーを追加すること

---

## 現在の状態

- [x] Phase 0: 準備と最大リスクの検証（クロスフェード / バックグラウンド耐性 / メモリ実測）
      — 詳細は `docs/PHASE0_SPIKES.md`。3スパイクとも自動検証・短時間の実ブラウザ検証は完了。
      フル10分放置と実聴確認は次回に持ち越し
- [~] Phase 1: MVPコア — タイマー状態機械・最小エンジン（1ループ+クロスフェード）・永続化・
      Page Visibility 再同期まで実装済み。UIは Home（自由再生の音選択）/ Pomodoro（タイマー）/
      Credit（説明・参考文献）の3タブ構成に拡張し、カスタムプリセット（作成・右クリック削除）も
      追加済み。エンジンはページ遷移をまたいで単一の AudioContext を共有するシングルトン設計
      （`apps/web/lib/soundscapeRuntime.ts`）。Break フェーズで無音になるバグ（フェーズ変化検出後に
      実際の遷移呼び出しを忘れていた）を発見・修正済み。
      **rev.3（本セッション）**: `docs/deep-research-report_chatGPT.md` /
      `集中力を高める音の文献調査_gemini.md` の文献調査をもとに、サウンドを「フェーズ(focus/break)」
      単位から「テーマ(5種)」単位に再構築（`docs/03_ARCHITECTURE.md` ADR-004）。Study/Work/Move/
      Relax/Sleep が音響的にも完全に別物になった（Home の選択にも Pomodoro の Focus テーマ選択にも
      実際に反映される。旧: 見た目の色だけが違って音は同一という状態だった）。ノイズ色を
      ピンク/ブラウン/エアで使い分け、テーマごとに専用の scale/bpm/automation/IR を持つ。
      **rev.3.1**: 全テーマの音量を一律 -15% 下げ、texture/cue/cell を Wikimedia Commons の
      実音源（雨・波の録音、鐘・鈴・カリンバの単音演奏）に差し替えた
      （加工記録: `packages/audio-engine/tools/process-real-audio.mjs`、
      出所・ライセンスは `docs/ASSET_LICENSES.md`、CC BY/CC BY-SA のクレジットは
      `apps/web/app/credit` に掲載済み）。Pad（和声の土台）とノイズ色（ピンク/ブラウン/エア）・
      Pulse は、テーマの調に正確なピッチの実音源が見つからなかった／精密な周波数特性の制御が
      必要という理由で意図的に合成のまま維持（理由は `docs/ASSET_LICENSES.md` に記載）。
      **rev.3.2**: `endel.io/science` と Haruvi et al. 2022（PMC8829886）を追加参照し、
      「集中力を上げる」だけでなく「聞きよい（restorative）」方向へ最終調整
      （`docs/03_ARCHITECTURE.md` ADR-005）。Cell の定位幅・音量をさらに絞り、実音源の
      フェードを柔らかく、硬質な学校鐘の音に軽いローパスをかけて丸めた。Move のテンポを
      112→120bpm（安静時心拍よりやや速い、という具体的数値提示に合わせる）に、
      Move/Relax の Cell 発火頻度をやや下げた。
      **rev.3.3**: 「集中力を上げる効果は維持しつつBGM性・音楽性を足す」ため、実装前に
      音楽理論・認知科学文献を調査した上で2点を追加（`docs/03_ARCHITECTURE.md` ADR-006）。
      (1) Pad層: 全テイクを同時ループ再生し、周期の異なるLFO（Eno の "Music for Airports"
      由来のテープループ・フェイジング技法）で音量ブレンドをドリフトさせ、離散的な
      「コードチェンジ」なしに和声/音色がゆったり変化するようにした
      （`PhaseGraph.addPadEnsemble`、`phase-graph.offline.test.ts` で実地検証済み）。
      (2) Pulse層: 固定周波数クリックをピッチドロップ式のキックドラム合成に変更し、
      Work/Move にはオフビートのハイハットを追加（Study は複雑思考向けのため追加せず）。
      **rev.3.4**: Study（読書・参考書での学習）と Work（PC作業・仕事、および作曲/ライティング
      などの創造的作業）の用途差をユーザーから明確化され、それぞれをブラッシュアップした
      （`docs/03_ARCHITECTURE.md` ADR-007）。Study はピンクノイズと`lowPassHz`をさらに
      暖色化（低覚醒・図書室的な質感）。Work は Endel の "Deep Work"（弦楽器/鍵盤/木質音・
      没入感のあるハーモニー）を参考に Pad へ木質ボディ共鳴を付与し、texture を
      "hum"→"room"（木質の部屋）へ、reverbWet を増やして没入感を、一方でハイハット/
      Cell密度は控えめにした（作曲・ライティングは言語/音楽処理そのものであり、装飾音の
      主張が強いと自分の思考と競合するため）。
      **rev.3.5**: `SoundscapeEngine.stop()` の既定フェードアウトを 1.0秒→0.4秒に変更
      （`pause()` と揃えた。Home/停止ボタンで音がすっと減衰して止まるようにする要望）。
      TopNav（Home/Pomodoro/Credit）のホバー時の文字まわりの発光を拡大・強化
      （広がり幅・ぼかし半径・最大不透明度をいずれも底上げ）。
      **rev.3.6**: `deep-research-report_relux_chatGPT.md` を踏まえ Relax/Sleep を全面
      再構築（`docs/03_ARCHITECTURE.md` ADR-008）。両テーマに「音楽性をある程度」持たせる
      ため、打楽器的キックとは別の柔らかい旋律アルペジオを奏でる `generateArpeggioPulse`
      を新設し、pulse レイヤーとして追加（Relax: D Lydian 70bpm、Sleep: D Aeolian低音域
      60bpmで8拍中3拍のみ）。Sleep は「最初40分=入眠用、以降=深い睡眠用」という要望に対し、
      文献の核心的な知見（継続的なノイズがREM睡眠を短縮しうる）を踏まえ「別の音に切り替える」
      のではなく「刺激を段階的に減らし静寂へ近づける」設計にした。Home のフリー再生は
      Sleep のときだけ実経過時間で t を進めるようにし（100分を仮想セッション長とし、
      40分がt=0.4に一致）、一晩中つけっぱなしにする使い方でも実時間で機能する
      （`apps/web/lib/soundscapeRuntime.ts`）。
      **rev.4**: ユーザーから「Study/Workの違いが分からない」「Moveは筋トレ・運動用でもっと
      別物のリズミカルな音にすべき」「Relaxのずっと上下する反響音が不快」という3つの指摘を受け、
      「今までの音は考慮せず」5テーマ全てを Endel の公開設計方針（endel.io/science,
      endel.io/focus, endel.io/activity, endel.io/relax）に基づいて再設計した
      （`docs/03_ARCHITECTURE.md` ADR-009）。Study は Study/Work/Move の中で唯一「拍」を
      持たないテーマに変更（Pulse は8拍に1音だけの疎らな一音）。Work は逆に規則的な拍を
      明確に採用し、キック+ハイハットに短いコンピング動機（`generateGroovePulse`、新設）を
      重ねた。Move は弧の構造自体を作り替え、ほぼ即座にフルゲインで始まり、キック+スネア+
      ハイハットの実際のドラムパターン（`generateWorkoutGroove`、新設）と拍同期でポンピングする
      Pad（`generatePad` の `pumpBpm`、新設）を持つ、他とは明確に別物のリズミカルな音にした
      （128bpmに変更）。Relaxの不快感はコード調査の結果、`phase-graph.ts` の Pad Ensemble
      LFO（ADR-006）の深さが過大だったことが根本原因と判明し、`PAD_DRIFT_DEPTH` を
      0.45→0.18に縮小（全テーマに影響する修正）。あわせて `PhaseAutomation` の
      `breathLfoHz`/`breathDepth` は実装されていない死んだフィールドだったため削除した。
      **rev.5**: 「Endelのように状況に合わせて音が変化するようにしたい」という要望を受け、
      天気・時間帯（朝/昼/晩）・音を流している経過時間の3軸で各テーマの音に控えめな補正を
      かける仕組みを実装した（`docs/03_ARCHITECTURE.md` ADR-010）。天気はブラウザの
      Geolocation API + Open-Meteo（APIキー不要の無料天気API）で取得し、失敗時は例外を投げず
      時間帯のみへフォールバックする。「音は作る前に条件に合うものを探し、なるべく既存の
      セットを用いる」という指示に従い、**新規音源はゼロ**（雨は既存の
      `audio/relax/texture_rain.wav` を全テーマ共通で再利用、雪は積雪の遮音効果を
      lowPassFactor で表現、時間帯は既存パラメータの微調整のみ）。変化は
      `smoothEnvironment`（指数平滑化、τ=90秒）で「ゆっくりなだらかに」切り替わる。
      「気分に合わせる＝気分に似た音を流すことではなく、そのタスクに適切な心理状態に導く
      こと」という指摘を踏まえ、全軸の効果量を控えめ（±20%以内）にし、3軸合成後も
      `clampModifier` で安全域にクランプしている。合わせて、Relax の不快感の原因調査で
      見つかった Pad Ensemble LFO（ADR-006）の depth 過大問題（`PAD_DRIFT_DEPTH` 0.45→0.18）
      も本セッションで修正済み（rev.4 内）。
      未着手: フェーズ切替時の背景色4秒補間（`docs/02_SPEC.md` §6.3）、
      Pad の実音源化（A/D/E キーに合う安定したドローン録音の追加探索）、
      天気・時間帯のUI表示（現状は音にのみ反映、画面上に状態を出していない）
      **rev.6**: Pomodoro に加えて「普通のタイマー」（/timer）と「ストップウォッチ」
      （/stopwatch）を選べるようにした。TopNav の "Pomodoro" タブは3つをまとめる
      "Timers" ボタンに改称し、押すと画面をぼかした上に Pomodoro/Timer/Stopwatch を選ぶ
      オーバーレイメニュー（`TimerToolsMenu` — 白文字・白い罫線、ボタン間の隙間では
      左右の縦棒だけが繋がって見える「梯子」状デザイン）が重なるようにした
      （`apps/web/components/TimerToolsMenu.tsx`）。Timer/Stopwatch は `packages/core` に
      Pomodoro のラウンド/休憩を持たない単純な状態機械（`countdown-state.ts`/
      `stopwatch-state.ts`、絶対時刻ベース・Clock注入という既存の設計を踏襲）を新設し、
      音の再生自体は Home のフリー再生（`playFreeplay`/`stopFreeplay`）をそのまま再利用した
      （タイマーの数字表示と、鳴らす音を分離する設計）。`useNow` はタイマー種別に依存しない
      よう `running: boolean` を引数に取る形へ汎化した。
      **rev.6.1**: UIフィードバックを反映。(1) Home はタイマー再生中に持ち越された古い
      `freeplayThemeId` があっても、`mode !== "freeplay"` の間は必ず「Kairos」の初期表示に
      戻るよう修正。(2) `TimerToolsMenu` を Timers ボタンの真下に正しくアンカー表示（framer-motion
      の `y`/`scale` アニメーションが `style.transform` を上書きしてしまい中央合わせがズレていた
      バグを修正）し、ボタンサイズと背景ぼかしを縮小。(3) Timer/Stopwatch の設定画面では
      選択中のサウンド/背景を常時プレビュー再生するようにした。(4) `25/10` を既定にする対象は
      Timer/Stopwatch ではなく **Pomodoro** だったと判明し、`packages/core` に新しい既定
      プリセット `STANDARD_PRESET`（25分/10分、id: `standard`）を追加してアプリ起動時の既定に
      した（Classic 25/5・Deep 50/10 は従来どおり選択可能）。Pomodoro の既定 Focus テーマも
      "work" → "study" に修正（Timer/Stopwatch はもともと "study" が既定で問題なし）。
      **rev.6.2**: Timer/Stopwatch設定画面で「サウンドが鳴らない」報告を追跡し、
      `ensureEngine()`（`apps/web/lib/soundscapeRuntime.ts`）に実在した競合状態を発見・修正。
      `if (engine) return engine` だけでは初期化完了前の多重呼び出しを防げず、TopNavの
      先取り初期化と各ページのマウント時初期化（Reactの StrictMode による副作用二重発火で
      さらに助長）が重なると AudioContext / SoundscapeEngine が複数生成され、後勝ちの
      インスタンスだけがモジュール変数に残り、先に作られた方に鳴らしたはずの音が届かず
      消えることがあった。in-flightの Promise 自体をキャッシュする方式に変更し、
      重複呼び出しは全員同じ初期化に相乗りするようにした。chrome-devtools MCP による
      実ブラウザ計測で AudioContext が常に1個だけ生成されることを確認済み。
      **rev.6.3**: 「25/10をデフォルトにする」変更（rev.6.1）を撤回し、Pomodoro の既定
      プリセットを元の `25/5`（`CLASSIC_PRESET`）に戻した。`STANDARD_PRESET`（25/10、
      id: `standard`）は削除し、`packages/core` の `BuiltinPresetId` は再び
      `"classic" | "deep"` の2種のみになった。カスタムプリセットの右クリック削除
      （赤いゴミ箱アイコン→クリックで削除、`PresetSelector.tsx`）は既存実装のまま維持
      （ビルトインの Classic/Deep は右クリックしても反応しない設計を継続）。
      **rev.6.4**: rev.6.2 の修正後も「サーバー再起動・別ブラウザでもTimers設定画面で音が
      鳴らない」という報告が続いたため、`SoundscapeEngine.init()`（`packages/audio-engine/
      src/engine.ts`）の自動再生ポリシー対策を強化した。従来は `AudioContext.resume()` の
      完了を無条件に `await` しており、SPA遷移でジェスチャーの連続性が切れた場合に
      resume() が pending のまま解決しないブラウザでは `init()` 自体が無期限に止まり、
      `engineReady` が永遠に true にならず「何をしても無反応」に見えていた可能性がある
      （自動化ブラウザでの計測ではこの状態を安定再現できなかったため、原因は推定を含む）。
      対策として (1) resume() の待機に1.5秒のタイムアウトを設け、`init()` 自体は必ず完了
      させるようにした。(2) resume() 後も `state !== "running"` のままなら、そのページ上で
      次に起きる実際の操作（pointerdown/keydown/touchend）で確実に `resume()` を再試行する
      listener を張った（`armGestureUnlock`。Chromeはブラウザ側でこれに近い自動再開を行うが、
      Firefox/Safari 等は resume() 呼び出し自体がジェスチャーのコールスタック内にあることを
      要求するため、明示的に張っている）。(3) Timer/Stopwatch設定画面に、
      `debugInfo.contextState` が `"suspended"` のままなら理由を示す小さなヒント文言と、
      `playFreeplay`/`ensureEngine` が例外を投げた場合に表示するエラーメッセージを追加し、
      これまで `console.error` のみで利用者には何も見えなかった失敗を可視化した
      （`apps/web/hooks/useFreeplay.ts` に `debugInfo` を追加露出）。
- [ ] Phase 3: 実運用に耐える体験
- [ ] Phase 4: 拡張

進捗はこのチェックリストを更新して管理してください。
