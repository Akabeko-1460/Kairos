# Kairos — ポモドーロ × 生成BGM Webアプリ 設計ドキュメント一式

Endel 型の「機能性サウンドスケープ」とポモドーロ・タイマーを組み合わせたアプリ。
**PC（Webアプリ）をメイン対象**とし、モバイルは PWA、必要になった段階でネイティブ化する。

このリポジトリは **Claude Code への引き継ぎ資料** です。
`CLAUDE.md` → `02_SPEC.md` → `04_SOUND_ENGINE.md` の順に読んでください。

> **改訂履歴 (rev.2)** — 初版は Flutter を前提にしていました。「PCメイン・Webアプリ最優先」
> という方針決定を受け、React / TypeScript / Web Audio API 構成に全面改訂しています。
> 経緯と却下理由は `03_ARCHITECTURE.md` の ADR に残してあります。

---

## ドキュメント構成

| ファイル | 内容 |
|---|---|
| `CLAUDE.md` | Claude Code 向けの作業指示・規約・禁止事項（最初に読む） |
| `01_ENDEL_RESEARCH.md` | Endel の調査結果。何を真似て何を真似ないか |
| `02_SPEC.md` | 機能要件・画面仕様・データモデル |
| `03_ARCHITECTURE.md` | 技術選定 ADR・ディレクトリ構成 |
| `04_SOUND_ENGINE.md` | **本プロジェクトの核**。生成BGMエンジンの詳細設計 |
| `05_IMPLEMENTATION_PLAN.md` | Phase 0〜4 のタスク分解と受け入れ条件 |
| `PHASE0_SPIKES.md` | Phase 0 の3スパイク（クロスフェード/バックグラウンド耐性/メモリ）の検証結果 |
| `ASSET_LICENSES.md` | 音素材・IRのライセンス台帳 |
| `research/` | サウンド設計の根拠にした外部文献調査（下記） |

### `research/`（文献調査）

音・BGMが集中力/リラックス/睡眠に与える影響について、実装着手前後に行った文献調査。
`03_ARCHITECTURE.md` の ADR や `04_SOUND_ENGINE.md` の設計根拠から個別に参照されている。

| ファイル | 内容 |
|---|---|
| `sound-environment-focus-chatgpt.md` | 音環境が集中力・作業効率に与える影響（ChatGPT Deep Research） |
| `bgm-productivity-chatgpt.md` | 音楽・BGMが認知機能・生産性に与える影響（ChatGPT Deep Research） |
| `relax-sleep-sound-chatgpt.md` | リラクゼーション・睡眠に対する音響刺激の効果（ChatGPT Deep Research） |
| `focus-sound-literature-review-gemini.md` | 集中力・生産性を最大化する音響条件の文献レビュー（Gemini Deep Research） |
| `focus-bgm-literature-review.md` | 集中力を最大化する音響条件に関する文献レビュー |
| `environment-adaptive-sound.md` | 聴覚刺激とリラクゼーション/認知パフォーマンスの文献調査（環境軸の設計根拠、ADR-010） |
| `relax-sleep-sound.md` | 聴覚刺激とリラクゼーション/認知パフォーマンスの文献調査（Relax/Sleep軸の設計根拠、ADR-008）※ `environment-adaptive-sound.md` と同一内容を別文脈向けに保持 |

---

## 30秒サマリ

**作るもの**
25/5 分・50/10 分のポモドーロタイマー。集中フェーズでは集中を助けるBGM、休憩フェーズでは
リラックスさせるBGMが自動で切り替わり、フェーズ内でも時間経過に応じて音が変化していく。

**技術方針**
- **Next.js (App Router) + TypeScript**。静的書き出しの完全クライアントサイドアプリ
- 音は **素の Web Audio API**。ライブラリを挟まない
- BGMは「AIで事前生成した**ステム素材**」を、実行時に**レイヤー合成・確率的スケジューリング**して無限生成する
- エンジンは `packages/audio-engine` に純粋TSで隔離し、将来 `react-native-audio-api` へそのまま移植できる形にする

**Endel の実装との関係**
Endel は Apple プラットフォームで Core Audio / AVFoundation を直接使うネイティブ実装です
（`01_ENDEL_RESEARCH.md` §3）。Web Audio API はブラウザにおける同じ立ち位置の低レベルAPIであり、
中間ライブラリを挟まないことで Endel と同等の制御粒度が得られます。

**再現度を決めるのはフレームワークではなくエンジン設計です。**
ステム素材の質、レイヤーのオートメーション曲線、確率的スケジューリング、クロスフェード。
ここに全体の8割の労力がかかります。

---

## 重要な前提（法務・倫理）

- Endel は自社の音生成技術（Endel Pacific）を**特許取得済み**と公表しています。
  本プロジェクトは「Endelを参考にした独自実装」であり、クローンとして公開するものではありません。
- 絶対に行わないこと:
  - Endel の音源・ロゴ・商標・UI意匠の複製や流用
  - "Endel" の名称をアプリ名・サイト表記・マーケティングに使用すること
  - 権利処理されていない音源・インパルス応答の同梱
- AI生成音源および実測IRは、**必ずライセンス条件を確認**してから同梱し、
  `docs/ASSET_LICENSES.md` に記録すること。無料プランでは商用利用不可のサービスがあります。
- 健康効果の訴求（「集中力が◯倍」等）は、自前のエビデンスがない限り書かないでください。

---

## 未確定事項（着手前に決めること）

| # | 決めること | デフォルト |
|---|---|---|
| 1 | アプリ名 / ドメイン | `Kairos`（確定） |
| 2 | 収益化 | Phase 1〜3 は課金なし |
| 3 | クラウド同期・アカウント | なし（完全ローカル） |
| 4 | 音源をどのAIサービスで作るか | 手元で試作 → 商用条件を確認して確定 |
| 5 | デスクトップのネイティブアプリ（Tauri） | **不要**。PWA で対応 |
