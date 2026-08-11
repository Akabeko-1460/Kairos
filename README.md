# Kairos

集中と休息のフェーズに合わせて最適なBGMを再生し、機械的な時間（クロノス）を質の高い集中時間（カイロス）へと変えるポモドーロタイマー。

Kairos: A Pomodoro timer app enriched with adaptive BGM, transforming mechanical time (Chronos) into meaningful, deep focus moments (Kairos).

## 開発ドキュメント

設計・仕様・技術選定の詳細は [`docs/`](./docs) を参照してください。特に `docs/CLAUDE.md` が作業指示の起点です。

- `docs/01_ENDEL_RESEARCH.md` — Endel の調査結果
- `docs/02_SPEC.md` — 機能要件・画面仕様・データモデル
- `docs/03_ARCHITECTURE.md` — 技術選定 ADR・ディレクトリ構成
- `docs/04_SOUND_ENGINE.md` — サウンドスケープ生成エンジンの設計
- `docs/05_IMPLEMENTATION_PLAN.md` — 実装フェーズと進捗
- `docs/PHASE0_SPIKES.md` — Phase 0 の3スパイク（クロスフェード/バックグラウンド耐性/メモリ）の検証結果
- `docs/ASSET_LICENSES.md` — 音素材・IRのライセンス台帳

## リポジトリ構成

```
apps/web/               Next.js アプリ（静的書き出し、完全クライアントサイド）
packages/core/           タイマー状態機械（純粋TS、React/DOM非依存）
packages/audio-engine/   サウンドスケープ生成エンジン（純粋TS、Web Audio APIのみに依存）
scripts/                 開発用スクリプト（仮素材生成など）
docs/                    設計ドキュメント
```

## セットアップ

```bash
pnpm install
pnpm dev      # apps/web を http://localhost:3000 で起動
pnpm build    # apps/web を静的書き出し（apps/web/out/）
pnpm test     # 全ワークスペースの vitest を実行
```

音の仮素材（開発用の合成音、ライセンス確認不要）を作り直す場合:

```bash
node scripts/generate-placeholder-audio.mjs
```
