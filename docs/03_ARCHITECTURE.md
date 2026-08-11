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
