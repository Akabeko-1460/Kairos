# 音素材・インパルス応答のライセンス台帳

docs/CLAUDE.md の禁止事項: 「ライセンスを確認していない音源・インパルス応答をリポジトリに追加すること」は禁止。
素材を追加したら必ずこの表に出所・生成サービス・ライセンス条件を記録すること。

## 実音源（Wikimedia Commons、公開ライセンス）

rev.3 で、コード生成の合成音だったものの一部を、実際に収録・公開されている音源に差し替えた
（`packages/audio-engine/tools/process-real-audio.mjs` で加工。トリミング・モノラル化・
フェード・ピーク正規化のみ行い、ピッチ/音色そのものは元音源のまま。rev.3.2 で
`endel.io/science` 等を踏まえ「聞きよさ」を高める調整として、フェードインを緩やかにし、
硬質な素材（学校鐘由来）にのみ軽いローパス(4.2kHz)を追加した — `docs/03_ARCHITECTURE.md`
ADR-005）。

**CC BY / CC BY-SA の素材はクレジット表示が必要。** `apps/web/app/credit` ページに、
下表の「表示すべきクレジット」列の内容を掲載すること（未実装。Phase 1 の残タスク）。

| ファイル | 元音源 | 出所URL | ライセンス | 表示すべきクレジット |
|---|---|---|---|---|
| `audio/relax/texture_rain.wav` | Rain against the window.ogg | https://commons.wikimedia.org/wiki/File:Rain_against_the_window.ogg | Public Domain | 不要（作者 Cori Samuel が PD 宣言） |
| `audio/relax/texture_waves.wav` | Waves.ogg | https://commons.wikimedia.org/wiki/File:Waves.ogg | Public Domain | 不要（作者 Dsw4 が PD 宣言） |
| `audio/cues/soft_chime.wav` | Bienenkorbglocke.1133.Hz.ogg | https://commons.wikimedia.org/wiki/File:Bienenkorbglocke.1133.Hz.ogg | CC0 1.0 | 不要（CC0） |
| `audio/cues/resolve.wav` | Old_school_bell_1.ogg | https://commons.wikimedia.org/wiki/File:Old_school_bell_1.ogg | Public Domain | 不要（作者 ezwa、pdsounds.org 経由） |
| `audio/study/cell_a3.wav`, `cell_g4.wav` | Old_school_bell_1.ogg | 同上 | Public Domain | 不要 |
| `audio/study/cell_c4.wav`, `cell_e4.wav` | Japanese_rin_played_as_struck_idiophone.ogg | https://commons.wikimedia.org/wiki/File:Japanese_rin_played_as_struck_idiophone.ogg | CC BY-SA 4.0 | "Japanese rin played as struck idiophone" by MichaelMaggs, CC BY-SA 4.0 |
| `audio/work/cell_a3.wav`, `cell_b3.wav`, `cell_c4.wav` | Old_school_bell_1.ogg | 同上 | Public Domain | 不要 |
| `audio/work/cell_e4.wav` | Spielwiese_Glocken.ogg | https://commons.wikimedia.org/wiki/File:Spielwiese_Glocken.ogg | CC BY-SA 2.0 DE | "Spielwiese Glocken" by Metzner, CC BY-SA 2.0 DE |
| `audio/move/cell_e4.wav`〜`cell_cs5.wav`（4件） | Kalimba.ogg | https://commons.wikimedia.org/wiki/File:Kalimba.ogg | CC BY-SA 3.0 / GFDL 1.2+ | "Kalimba" by Worldmaster0, CC BY-SA 3.0 |
| `audio/relax/cell_d4.wav`, `cell_fs4.wav`, `cell_a4.wav` | Spielwiese_Glocken.ogg | 同上 | CC BY-SA 2.0 DE | "Spielwiese Glocken" by Metzner, CC BY-SA 2.0 DE |
| `audio/relax/cell_cs5.wav` | Bristol_Chimes.ogg | https://commons.wikimedia.org/wiki/File:Bristol_Chimes.ogg | CC BY 3.0 | "Bristol Chimes" (via Freesound), CC BY 3.0 |
| `audio/sleep/cell_d3.wav`, `cell_f3.wav`, `cell_a3.wav` | Japanese_rin_played_as_struck_idiophone.ogg | 同上 | CC BY-SA 4.0 | "Japanese rin played as struck idiophone" by MichaelMaggs, CC BY-SA 4.0 |

> **CC BY-SA の継承条項について**: 上記の CC BY-SA 素材から切り出した派生ファイル
> （トリミング・正規化のみ、ピッチ/音色の改変なし）は、元素材と同じ CC BY-SA ライセンスの
> 対象になる。Kairos アプリ全体やコードのライセンスには影響しないが、当該 wav ファイル単体を
> 再配布する場合は同条件を維持すること。

## 合成音（コード生成、プレースホルダー）

以下は `scripts/generate-placeholder-audio.mjs` によるコード生成の合成音のまま。
理由は各行に記載（多くは「精密な周波数特性の制御が必要」「テーマの調に正確なピッチの実音源が
見つからなかった」）。

| ファイル | 種別 | 出所 | ライセンス | 備考 |
|---|---|---|---|---|
| `audio/{study,work,relax,sleep}/pad_*.wav` | Pad（和声の土台） | `generate-placeholder-audio.mjs` の合成音 | 権利者なし | 探索したが、テーマの調（A/D）に正確に一致し、かつピッチが安定した実音源ドローンが見つからなかった（例: ディジュリブーンのD keyドローンは持続中に76〜318Hz相当まで音程が動き、和声の土台には使えないと判断）。次回以降の探索課題。Work の pad は ADR-007 で木質楽器/弦楽器のボディ共鳴を模した帯域（700Hz付近）を付与している |
| `audio/{study,work}/texture_pink*.wav`, `work/texture_room.wav` | Texture（ピンクノイズ / room） | 同上 | 権利者なし | ノイズ色は物理信号であり、文献が推奨する周波数特性（-3dB/オクターブ等）を精密に合成で制御する方が本来の効果を再現しやすいと判断し、意図的に合成のまま維持。`work/texture_room.wav` は ADR-007 で旧 `texture_hum.wav`（オフィス空調ハム）から「木質の部屋」を思わせる帯域ノイズに置き換えた |
| `audio/move/texture_air_*.wav` | Texture（そよ風質感） | 同上 | 権利者なし | 実音源を探索したが、公開されている風の録音は強風（25m/s の暴風、台風接近など）しか見つからず、Move の「軽く開放的」という設計意図に合わなかったため見送り |
| `audio/sleep/texture_brown_*.wav` | Texture（ブラウンノイズ） | 同上 | 権利者なし | 同上（ノイズ色は合成が適切という判断） |
| `audio/study/pulse_*.wav` | Pulse（8拍に1音だけの疎らな一音） | 同上（`generateArpeggioPulse`、ADR-009） | 権利者なし | ADR-009: Endel "Read" は規則的な拍を持たないため、打楽器的なキックを廃止し極端に間引いた旋律生成器に変更 |
| `audio/work/pulse_*.wav` | Pulse（キック+ハイハット+コンピング動機のグルーヴ） | 同上（`generateGroovePulse`、ADR-009） | 権利者なし | 特定のBPMにサンプル精度で同期させる必要があり、合成が確実 |
| `audio/move/pulse_*.wav` | Pulse（キック+スネア+ハイハットの実ドラムパターン） | 同上（`generateWorkoutGroove`、ADR-009） | 権利者なし | 特定のBPMにサンプル精度で同期させる必要があり、合成が確実 |
| `audio/move/pad_*.wav` | Pad（拍同期ポンピング） | 同上（`generatePad` の `pumpBpm`、ADR-009） | 権利者なし | 和音の土台自体を運動のリズムに同調させるため、拍と正確に整数倍でループする必要があり合成 |
| `audio/relax/pulse_*.wav`, `audio/sleep/pulse_*.wav` | Pulse（柔らかい旋律アルペジオ） | 同上（`generateArpeggioPulse`、ADR-008/ADR-009） | 権利者なし | 「音楽性をある程度」持たせる要望に対し、スケール内の音程を辿るフレーズを生成。テーマの調に正確なピッチが必要なため合成 |
| `ir/*.wav` | インパルス応答 | 同上（減衰ホワイトノイズによる合成IR） | 権利者なし | 本番は実測IR or 権利確認済みの公開IRライブラリに差し替える |

## 本番差し替え時のチェックリスト（docs/CLAUDE.md 禁止事項より）

- [ ] 生成に使ったAIサービス名とプラン（無料/商用利用可否）を記録する
- [ ] 商用利用不可の無料プランで生成した素材を同梱していないか確認する
- [ ] Endel の音源・ロゴ・商標・UI意匠を複製・流用していないか確認する
- [ ] ボーカル入り・明確なメロディを持つ素材を BGM 素材として使っていないか確認する
- [ ] 公開IRライブラリ（OpenAIR 等）を使う場合はライセンス条件をここに転記する
- [ ] CC BY / CC BY-SA 素材のクレジットを `apps/web/app/credit` ページに掲載する（現状未実装）

## 記録テンプレート

```
| ファイル | 生成サービス / 収録元 | ライセンス | 生成日 | 商用利用 |
|---|---|---|---|---|
| /audio/focus/pad_a_01.ogg | (例: Suno / Udio / 自前録音) | (例: サービスのProプラン規約, URL) | 2026-XX-XX | 可 / 不可 |
```
