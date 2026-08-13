# 02. 要件・仕様

> **これは着手前に書いた初期の仕様書です。** 機能要件のID（F-01〜F-29）は今も
> ADR やコミットから参照される現役の語彙ですが、**画面仕様は実装と異なります**
> （Timer / Stopwatch / Credit の追加、Home のテーマ選択、Timers メニューなどは未反映）。
> 画面の実際の姿は `apps/web/app/` を、進捗は `CLAUDE.md` のチェックリストを見てください。
>
> 特記: **F-10（合図音）は「切替の直前」ではなく「区間が終わった時点」で鳴らす実装**にした。
> `SoundscapeEngine.playCue()` がテーマのフェードを経由せずユーザー音量へ直結するので、
> 終了と同時に音を止めても通知は消えない。強さは用途で変えている
> （Pomodoro = 軽い区切り、Timer = 席を外していても気づく繰り返し）。

---

## 1. プロダクトの定義

> 有限のポモドーロ・セッションに対して、始まりから終わりまでの「音の弧」を毎回その場で組み立てるタイマー。

- 集中フェーズ（25分 / 50分）: 集中を助けるBGM
- 休憩フェーズ（5分 / 10分）: リラックスを助けるBGM
- フェーズ間はシームレスにクロスフェードで移行し、無音の断絶を作らない
- 同じ設定でも毎回わずかに違う音になる（決定的シード＋確率的スケジューリング）

## 2. 想定ユーザー / 利用シーン

デスクワーク・学習中に、集中の入口と出口を音で管理したい人。
イヤホン／スピーカーの両方を想定。ながら聴きが前提なので、**注意を奪う音は失敗**。

---

## 3. 機能要件

### 3.1 MUST（Phase 1〜2 で実装）

| ID | 要件 |
|---|---|
| F-01 | プリセット `25/5`（Classic・既定）・`50/10`（Deep）を切り替えられる |
| F-02 | 開始 / 一時停止 / 再開 / スキップ / リセット |
| F-03 | 集中→休憩→集中 と自動で連続する。ラウンド数を事前に設定できる（既定4） |
| F-04 | 4ラウンドごとに長い休憩（Classic: 15分 / Deep: 20分） |
| F-05 | セッションのタスク名を入力・表示できる（Endel の Task Headline 相当） |
| F-06 | 残り時間と進捗を大きな円形インジケータで表示 |
| F-07 | 集中フェーズでは Focus サウンドスケープ、休憩フェーズでは Break サウンドスケープが自動再生 |
| F-08 | フェーズ内の経過に応じて音が変化する（3フェーズの弧、`04_SOUND_ENGINE.md`） |
| F-09 | フェーズ切替時に無音を挟まずクロスフェードする |
| F-10 | フェーズ切替の直前に「合図音（cue）」が鳴る |
| F-11 | マスター音量調整、ミュート |
| F-12 | 完全オフラインで動作する |
| F-13 | **タブを裏にしても／別アプリに切り替えても、音とカウントが途切れない**（rev.2 で最重要要件に格上げ。`03_ARCHITECTURE.md` ADR-003 の制約1を参照） |
| F-14 | メディアキー / OSのメディアコントロールから再生制御できる（Media Session API。Phase 3） |
| F-15 | タイマーは絶対時刻基準で、スリープ復帰後もズレない |

> **rev.2 の注記:** F-13 / F-14 は当初モバイルネイティブ前提の要件でしたが、
> Web ファーストへの方針変更に伴い「ブラウザタブでの継続再生」「メディアキー対応」に
> 読み替えています。モバイルOSのバックグラウンド再生とロック画面制御は Phase 4 で回収します。

### 3.2 SHOULD（Phase 3）

| ID | 要件 |
|---|---|
| F-20 | インターバル長のカスタム設定 |
| F-21 | 日別／週別の集中時間・完了ポモドーロ数・連続日数の統計 |
| F-22 | レイヤー（パッド／自然音／パルス）の個別ON/OFFと音量 |
| F-23 | 音声に連動した抽象ビジュアライザ |
| F-24 | フェーズ切替のローカル通知 |
| F-25 | 複数サウンドパックの切り替え（例: Warm / Cold / Rain / Noise Only） |
| F-26 | ダークテーマ（既定）／ライトテーマ |
| F-27 | キーボードショートカット（Space で開始/停止 など） |
| F-28 | PWA としてインストール可能（マニフェスト、アイコン、オフラインキャッシュ） |
| F-29 | Screen Wake Lock で集中中に画面を消させない |

### 3.3 COULD（Phase 4）

追加サウンドパックのCDN配信 / iOS Live Activity・Dynamic Island / Android ウィジェット /
Lyria RealTime によるリアルタイム生成の実験 / 課金 / クラウド同期 / 心拍・時刻連動

### 3.4 非機能要件

| 項目 | 目標 |
|---|---|
| 起動〜再生開始 | 1.5秒以内 |
| フェーズ切替のグリッチ | ゼロ（クリック音・無音区間を出さない） |
| メモリ | 音源展開後 200MB 以下 |
| 転送量 | 音源の初回ダウンロード合計 40MB 以下（超えるならオンデマンドDLへ） |
| 対応環境 | Chrome / Edge / Safari 16.4+ / Firefox の最新2バージョン。PC が主、モバイルは PWA |
| メモリ | 音源展開後 200MB 以下（`decodeAudioData` は非圧縮 Float32。ADR-003 の制約2） |
| 初回ロード | 最初のフェーズ分の音源だけ先読みし、3秒以内に開始できること |

---

## 4. 状態機械（タイマー）

```
              start()
   [Idle] ─────────────► [Focus:Running]
      ▲                    │  │  ▲
      │            pause() │  │  │ resume()
      │                    ▼  │  │
      │              [Focus:Paused]
      │                    │
      │        complete() / skip()
      │                    ▼
      │        最終ラウンド？ ─ Yes → [Completed] → [Idle]
      │                    │
      │                   No
      │                    ▼
      │           [Break:Running] ──pause()──► [Break:Paused]
      │                    │
      │        complete() / skip()
      │                    ▼
      └── reset() ── [Focus:Running]（次ラウンド）
```

- `Focus` は `focus`、`Break` は `shortBreak` / `longBreak` に分岐
- 4ラウンド目（= `roundsBeforeLongBreak` の倍数）完了後は `longBreak`
- **最終ラウンドの `Focus` が終わったときは休憩を挟まず、そのまま `Completed` にする**
  （最後の休憩はユーザーにとって無意味なため。`shortBreak`/`longBreak` いずれも同様）
- **一時停止中は音もフェードアウトして停止する**（ポーズ中に鳴り続けると集中の合図として機能しなくなる）

---

## 5. データモデル

```ts
type SessionPhase = 'idle' | 'focus' | 'shortBreak' | 'longBreak' | 'completed';

/** プリセット */
interface PomodoroPreset {
  readonly id: 'classic' | 'deep' | 'custom';
  readonly label: string;              // '25 / 5'
  readonly focusMs: number;            // 25min | 50min
  readonly shortBreakMs: number;       // 5min  | 10min
  readonly longBreakMs: number;        // 15min | 20min
  readonly roundsBeforeLongBreak: number;  // 4
}

/** タイマーの実行時状態。phaseStartedAt は「絶対時刻」であることが重要。 */
interface TimerState {
  readonly phase: SessionPhase;
  readonly preset: PomodoroPreset;
  readonly phaseStartedAt: number | null;  // epoch ms。現フェーズを開始した壁時計時刻
  readonly accumulatedPauseMs: number;     // このフェーズ内で一時停止していた合計
  readonly pausedAt: number | null;
  readonly currentRound: number;           // 1-indexed
  readonly totalRounds: number;
  readonly taskHeadline: string;
  readonly sessionSeed: number;            // 音の再現性のための乱数シード
}

// 以下はすべて packages/core の純粋関数として実装する（TimerState のメソッドにしない）
function phaseDurationMs(s: TimerState): number;
function elapsedMs(s: TimerState, now: number): number;   // now - phaseStartedAt - accumulatedPauseMs
function remainingMs(s: TimerState, now: number): number;
function progress(s: TimerState, now: number): number;    // 0.0 .. 1.0 → 音エンジンへ渡す t
function isRunning(s: TimerState): boolean;

/** 統計（Phase 3） */
interface SessionRecord {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly phase: SessionPhase;
  readonly plannedMs: number;
  readonly actualMs: number;
  readonly completed: boolean;             // スキップ/中断なら false
  readonly taskHeadline: string;
  readonly soundPackId: string;
}
```

永続化は IndexedDB（`idb` ラッパ）。設定は localStorage。同期は Phase 4。

**タイマー実装の必須事項**
- `setInterval(1s)` は **UI更新のトリガーにのみ使う**。残り時間は毎回 `Date.now()` から再計算すること
  （非表示タブでは `setInterval` が毎秒1回以下に絞られるため、回数を数えると必ずズレる）
- Page Visibility API の `visibilitychange` で復帰時に必ず再計算し、
  経過がフェーズ長を超えていれば即座に次フェーズへ遷移する
- `phaseStartedAt` と `accumulatedPauseMs` を永続化し、リロード後も復元できるようにする
- **音のスケジューリングはこの時計とは別系統。** `AudioContext.currentTime` を基準に
  Web Worker のティッカーで先読みする（`04_SOUND_ENGINE.md` §6.1）

---

## 6. 画面仕様

### 6.1 デザイン原則
Endel と同様、**UIそのものが集中を妨げてはならない**。

- 暗い背景（`#0A0A0C` 系）、彩度の低い1〜2色のアクセント
- 情報密度は極小。1画面1目的
- 再生開始後は数秒でUIを減光し、操作要素をフェードアウトさせる（タップで再表示）
- アニメーションは遅く・連続的に。点滅・急な動き・カウントダウンの派手な演出は禁止
- フォントは1書体。数字はタビュラー（等幅数字）にして桁揺れを防ぐ

### 6.2 画面一覧

**A. ホーム / タイマー（メイン）**
```
┌──────────────────────────────┐
│  Kairos               ⚙       │
│                              │
│        ╭──────────╮          │
│       ╱            ╲         │   ← 円形プログレスリング
│      │   24:13      │        │      進捗に沿って弧が伸びる
│      │   FOCUS      │        │      背後に音量連動の淡いグロー
│       ╲            ╱         │
│        ╰──────────╯          │
│                              │
│   ○ ● ○ ○   Round 2 of 4     │   ← ラウンドインジケータ
│                              │
│   「設計書のレビュー」          │   ← Task Headline（タップで編集）
│                              │
│      ⏸        ⏭        ↺      │
│                              │
│ [25/5] [50/10]                │   ← 停止中のみ表示（左が既定）
└──────────────────────────────┘
```

**B. 設定**
プリセット / ラウンド数 / 自動継続 ON-OFF / サウンドパック選択 /
レイヤー音量（Pad, Texture, Pulse, Cells）/ 合図音 ON-OFF / 通知 / テーマ

**C. 統計（Phase 3）**
今日の集中時間、週次の棒グラフ、連続日数、累計ポモドーロ数

### 6.3 フェーズ切替時の演出
1. 終了30秒前: 音のパルスが減衰し始める（音だけで終わりが近いと分かる）
2. 終了5秒前: 合図音（cue）を1回。UIのリングがゆっくり呼吸するように脈動
3. 切替: 背景色を 4秒かけて Focus色 ⇄ Break色 に補間。音は 6秒クロスフェード
4. 切替後: フェーズ名を2秒だけ大きく表示してフェードアウト

Focus のアクセント色は寒色（例 `#4C6EF5` 系の低彩度）、Break は暖色〜緑（例 `#3FAE8E` 系）。

---

## 7. 受け入れテスト（抜粋）

- [ ] 25分セッションを最後まで再生して、無音区間・クリック音・音量の急変が一度も起きない
- [ ] 集中→休憩の切替が、音を止めることなく行われる
- [ ] **タブを裏にして10分放置し、戻っても音が途切れておらず残り時間も正確**
- [ ] 機内モード（オフライン）で全機能が動作する
- [ ] 同じプリセットで2回連続実行したとき、音の展開が同一ではない
- [ ] メディアキーから一時停止・再開ができる
- [ ] Safari でも Chrome と同じように鳴る
- [ ] `OfflineAudioContext` のRMS検証とクリッピング検証が通る
