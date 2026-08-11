# Phase 0 スパイク結果

docs/05_IMPLEMENTATION_PLAN.md Phase 0 の3スパイクの実施記録。
「0-2 か 0-3 が破綻するなら、その後の全計画を見直す価値がある」とされている最重要ゲート。

---

## スパイクA: 等パワークロスフェード（0-2, 0-5）

**結論: 破綻なし。実測で確認済み。**

`packages/audio-engine/src/crossfade.offline.test.ts` で、Node上で実際に動く
`OfflineAudioContext`（`node-web-audio-api` = web-audio-api-rs のバインディング）を使い、
2本の独立したホワイトノイズ（同一RMS）を `GainNode.setValueCurveAtTime` + 等パワーカーブで
実際にクロスフェードし、レンダリング結果を検証した。

- クロスフェード区間内の複数チェックポイント（中間点 t=4.0s を含む）で、RMSが定常状態から
  **±1.5dB 以内**に収まることを確認（docs/04_SOUND_ENGINE.md §8 の受け入れ基準どおり）
- レンダリング結果に `|sample| > 1.0` のクリッピングが無いことを確認
- 対照実験として同じパイプラインで**線形カーブ**を試すと、中間点で ±1.5dB を明確に超えて
  「谷」ができることを回帰テストとして残してある（`equal-power.test.ts` にも数式レベルの
  恒等式検証 `sin²+cos²=1` として同じ主張を二重に担保）

**実ブラウザでの確認**: `apps/web` の Home 画面から実際に Start → 25分セッションを最後まで
再生し、フェーズ切替のクロスフェードを実際に耳で聴く検証はまだ行っていない
（本番アセットではなく `scripts/generate-placeholder-audio.mjs` の合成音でのみ確認）。
docs/04_SOUND_ENGINE.md §8 の「実聴は自動テストで代替できない」という原則どおり、
このセッションでは自動検証までを済ませた状態。**次のセッションで手動の実聴確認を推奨。**

---

## スパイクB: バックグラウンドタブ耐性（0-3）

**結論: 破綻なし。実ブラウザで確認済み（短時間）。**

実装: `packages/audio-engine/src/scheduler.worker.ts`（25ms間隔でtickを送るWeb Worker）+
`worker-ticker.ts`（WorkerTicker）+ `engine.ts` の `serviceCellScheduling()`
（`ctx.currentTime` を基準に常に2秒先までCellイベントを予約）。

chrome-devtools 経由で実際に検証した手順と結果:

1. `pnpm dev` で開発サーバーを起動し、実際のChromeで `http://localhost:3000` を開いた
2. Start を押して Focus フェーズを開始。Debug パネルで `ctx state: running`、
   `ctx.currentTime` が増加していること、`next cell in`（次のCell発火までの残り秒数）が
   意味のある正の値であることを確認
3. ベースラインを記録: 壁時計 18:13:11、`ctx.currentTime = 24.64s`
4. 別タブを前面に出して Kairos タブをバックグラウンドへ回し、約150秒放置
5. Kairos タブへ戻り、Debug パネルを再確認: 壁時計 18:15:41、`ctx.currentTime = 175.29s`

**結果**: 壁時計の経過は 150.70秒、`ctx.currentTime` の経過は 150.65秒 —
**差はわずか0.05秒**。バックグラウンド中も `AudioContext` の時刻が壁時計と完全に同じペースで
進み続けたことを確認できた。`next cell in` も `3.69s` という健全な正の値のままで、
Infinity・負値・停止といった破綻の兆候は無し。コンソールエラーも0件。

**残作業**: docs/05_IMPLEMENTATION_PLAN.md の完了条件は「タブを裏にして**10分**放置しても
Cellの発火が途切れない」。今回は約150秒（2分30秒）の確認にとどめており、
**フル10分間の放置確認と、実際に音が途切れていないかの耳での確認は未実施**。
今回の結果（150秒間ズレ0.05秒）から破綻する兆候は見られないが、
次のセッションでフル10分版の確認を行うことを推奨。

---

## スパイクC: メモリ実測（0-4）

**方針: 今回は理論値計算のみで済ませ、実測は後回し（ユーザー承認済み）。**

`decodeAudioData` は非圧縮 Float32 になる前提（docs/03_ARCHITECTURE.md ADR-003）で、
`packs.json`（`apps/web/public/packs.json`）に定義した本プロジェクトのステム構成から
理論値を計算した。

計算式: `bytes = seconds × 44100 × channels × 4`

### シナリオA: 本番想定（Pad=ステレオ、Texture/Cell/Cue/IR=モノラル）

focus と break の両フェーズ分が**同時に常駐**する最悪ケース（クロスフェード中は両方のグラフが
メモリ上に存在する）で計算。

| レイヤー | サイズ |
|---|---|
| focus.pad（32s ×3テイク） | 33.87 MB |
| focus.texture（20s ×2テイク、モノラル） | 7.06 MB |
| focus.pulse（7.27s ×2テイク） | 5.13 MB |
| focus.cell（2.2s ×4本、モノラル） | 1.55 MB |
| break.pad（30s ×2テイク） | 21.17 MB |
| break.texture（24s ×2テイク、モノラル） | 8.47 MB |
| break.cell（2.6s ×3本、モノラル） | 1.38 MB |
| cues（2本、モノラル） | 0.74 MB |
| IR（2本、モノラル） | 0.81 MB |
| **合計（focus+break同時常駐）** | **約 80.2 MB** |

200MB予算に対して **約120MBの余裕**。ループ長を32秒以下に抑える制約
（docs/03_ARCHITECTURE.md ADR-003 既知の制約2）を守ったまま、pad をステレオにしても
十分な余裕があることを確認できた。

### シナリオB: 現行プレースホルダーの実態（全素材モノラル）

`scripts/generate-placeholder-audio.mjs` が生成する現在の仮素材はすべてモノラルなので、
実際のフットプリントはさらに小さく **約 50.1 MB**。

### 結論・示唆

- 現在のループ長設計（pad 30–32s、texture 20–24s、pulse 7.27s）のままで、
  本番でPadをステレオ化しても200MB予算を大きく下回る
- 余裕が大きいため、Phase 2 で LoopManager がテイク数を増やしても
  （例: pad を3→5テイクにする等）まだ十分な余地がある
- **ただしこれは理論値であり、ブラウザの実メモリ使用量（デコード後のバッファ以外の
  オーバーヘッドを含む）を DevTools で実測したわけではない。** 本番アセット差し替え後、
  Phase 3 のクロスブラウザ検証と合わせて実測することを推奨（このリポジトリには
  chrome-devtools 系のMCPツールが使える環境があるため、`take_heapsnapshot` 等で
  比較的簡単に検証できる）

---

## 総括

3スパイクとも「破綻の兆候なし」で、Phase 1 以降の計画を見直す必要は無いと判断できる。
ただし以下は自動検証の範囲外として次セッションへ持ち越し:

- [ ] 25分/50分セッションの通し再生を実際に聴いて、クロスフェード・ループ継ぎ目・
      Cellの音量感を耳で評価する（docs/04_SOUND_ENGINE.md §8: 実聴は自動テストで代替不可）
- [ ] タブを裏にして**フル10分**放置する長時間版のスパイクB検証
- [ ] Chrome DevTools の実ヒープスナップショットによるスパイクCの実測（理論値の裏付け）
- [ ] Safari / Firefox でのクロスブラウザ確認（`setValueCurveAtTime` は実装差が出やすいと
      docs/05_IMPLEMENTATION_PLAN.md のリスク表に明記されている）
