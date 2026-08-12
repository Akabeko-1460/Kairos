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
      未着手: フェーズ切替時の背景色4秒補間（`docs/02_SPEC.md` §6.3）、
      Pad の実音源化（A/D/E キーに合う安定したドローン録音の追加探索）
- [ ] Phase 2: 生成エンジン本体（LoopManager のテイクローテーション、AI生成の本番素材への差し替え、実聴での音作り）
- [ ] Phase 3: 実運用に耐える体験
- [ ] Phase 4: 拡張

進捗はこのチェックリストを更新して管理してください。
