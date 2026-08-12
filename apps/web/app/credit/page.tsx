// docs/ASSET_LICENSES.md より: CC BY / CC BY-SA の音源はクレジット表示が必須（CC0 / Public Domain は不要なので含めない）。
const SOUND_CREDITS = [
  {
    title: "Japanese rin played as struck idiophone",
    author: "MichaelMaggs",
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:Japanese_rin_played_as_struck_idiophone.ogg",
  },
  {
    title: "Spielwiese Glocken",
    author: "Metzner",
    license: "CC BY-SA 2.0 DE",
    url: "https://commons.wikimedia.org/wiki/File:Spielwiese_Glocken.ogg",
  },
  {
    title: "Kalimba",
    author: "Worldmaster0",
    license: "CC BY-SA 3.0",
    url: "https://commons.wikimedia.org/wiki/File:Kalimba.ogg",
  },
  {
    title: "Bristol Chimes",
    author: "Freesound.org 経由でアップロード",
    license: "CC BY 3.0",
    url: "https://commons.wikimedia.org/wiki/File:Bristol_Chimes.ogg",
  },
];

// サウンド設計（テーマごとの scale/bpm/automation、環境軸の補正など）の根拠として実際に
// 参照した文献調査のみを掲載する。docs/research/ には調査段階で集めた文献調査が他にもあるが、
// 設計に直接反映されなかったものはここには載せない（参照箇所は docs/03_ARCHITECTURE.md の
// 各 ADR、docs/04_SOUND_ENGINE.md、該当する packages/audio-engine のソースコメントを参照）。
const RESEARCH_CITATIONS = [
  {
    title: "音環境が集中力・作業効率に与える影響（ChatGPT Deep Research）",
    note: "5テーマ（Study/Work/Move/Relax/Sleep）を独立した音響定義にした ADR-004 の根拠のひとつ。",
    path: "docs/research/sound-environment-focus-chatgpt.md",
  },
  {
    title: "集中力・生産性を最大化する音響条件の文献レビュー（Gemini Deep Research）",
    note: "ADR-004 の根拠のひとつ。音楽家に対する歌詞付きBGMの逆効果など、Work テーマのハイハット/Cell密度を抑えた根拠（ADR-007）にも使用。",
    path: "docs/research/focus-sound-literature-review-gemini.md",
  },
  {
    title: "リラクゼーション・睡眠に対する音響刺激の効果（ChatGPT Deep Research、Cochraneレビュー中心）",
    note: "Relax/Sleep の全面再構築（ADR-008）の根拠。60–80BPMの柔らかい旋律アルペジオ、継続的ノイズがREM睡眠を短縮しうるという知見に基づくSleepの段階的減衰設計に使用。",
    path: "docs/research/relax-sleep-sound-chatgpt.md",
  },
  {
    title: "聴覚刺激とリラクゼーション/認知パフォーマンスの文献調査",
    note: "天気・時間帯・経過時間による控えめな補正（ADR-010）の根拠。長時間再生時の聴取疲労を避ける漸減設計にも使用。",
    path: "docs/research/environment-adaptive-sound.md",
  },
];

const REFERENCES = [
  {
    title: "Endel — Technology",
    note: "サウンドスケープ生成エンジン「Endel Pacific」の構造（Inputs / Core AI Logic / Sound generation / Output）についての一次情報。",
    url: "https://endel.io/technology",
  },
  {
    title: "Endel — Science",
    note: "Focus/Relax/Sleep それぞれの音響設計原則（一定のビート、自然音によるマスキング等）の根拠。",
    url: "https://endel.io/science",
  },
  {
    title: "Endel — Focus Timer",
    note: "ポモドーロ・テクニックに基づくシナリオ機能。本プロジェクトの直接の参照元。",
    url: "https://endel.io/focus",
  },
  {
    title: "Arctop et al., 2021, Frontiers in Computational Neuroscience",
    note: "Endelのサウンドスケープが、プレイリストや無音と比較して集中の持続性を高めると報告する査読付き研究。",
    url: "https://www.frontiersin.org/articles/10.3389/fncom.2021.760561/full",
  },
  {
    title: "Apple Developer — Spotlight on: Spatial Audio",
    note: "EndelがCore Audio / AVFoundationを用いたネイティブ実装であることの一次情報。技術選定（ADR-002）の根拠。",
    url: "https://developer.apple.com/news/?id=0vz78ua8",
  },
  {
    title: "TechCrunch — Endel and Sony partnership",
    note: "「ステムベースのサウンドスケープを、アルゴリズムが組み立てる」というエンジンの実体についての共同創業者インタビュー。",
    url: "https://techcrunch.com/2022/05/20/endel-sony-partnership/",
  },
];

export default function CreditPage() {
  return (
    <div className="flex flex-1 justify-center px-8 py-16">
      <div className="flex w-full max-w-2xl flex-col gap-14">
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-medium text-foreground">Kairos について</h1>
          <p className="text-sm leading-7 text-muted">
            Kairos は、集中フェーズと休憩フェーズに合わせて自動生成されるサウンドスケープを組み合わせた
            ポモドーロタイマーです。機械的に区切られた時間（クロノス）を、質の高い集中と回復のための
            意味ある時間（カイロス）へと変えることを目指しています。
          </p>
          <p className="text-sm leading-7 text-muted">
            集中フェーズでは注意を引かずに覚醒度を保つサウンド、休憩フェーズでは副交感神経を優位にする
            サウンドが自動で切り替わり、フェーズ内でも時間の経過に応じて音がゆっくり変化し続けます。
            同じ設定で実行しても、毎回わずかに違う音の展開になります。
          </p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium tracking-wide text-foreground">使い方</h2>
          <ul className="flex flex-col gap-3 text-sm leading-7 text-muted">
            <li>
              <span className="text-foreground">Home</span> —
              サウンドスケープを選んで、ポモドーロと関係なく自由に流し続けられます。
            </li>
            <li>
              <span className="text-foreground">Pomodoro</span> —
              プリセット（25/5・50/10、または独自のカスタム設定）を選んでセッションを開始します。
              集中と休憩が自動で交互に切り替わり、フェーズ切替は音がクロスフェードして無音を挟みません。
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium tracking-wide text-foreground">参考文献・記事</h2>
          <p className="text-xs leading-6 text-muted/80">
            Kairos は Endel の「機能性サウンドスケープ」という設計思想を参考にした独自実装です。
            Endel の音源・ロゴ・商標・UI意匠は一切使用していません。詳しい調査記録は
            リポジトリの <code className="rounded bg-surface px-1 py-0.5 text-[11px]">docs/01_ENDEL_RESEARCH.md</code> にあります。
          </p>
          <ul className="flex flex-col gap-4">
            {REFERENCES.map((ref) => (
              <li key={ref.url} className="border-l border-border pl-4">
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {ref.title}
                </a>
                <p className="mt-1 text-xs leading-6 text-muted">{ref.note}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium tracking-wide text-foreground">サウンド設計の文献調査</h2>
          <p className="text-xs leading-6 text-muted/80">
            各テーマの scale/bpm/automation や、天気・時間帯による補正は、以下の文献調査を根拠にしています。
          </p>
          <ul className="flex flex-col gap-4">
            {RESEARCH_CITATIONS.map((citation) => (
              <li key={citation.path} className="border-l border-border pl-4">
                <p className="text-sm text-foreground">{citation.title}</p>
                <p className="mt-1 text-xs leading-6 text-muted">{citation.note}</p>
                <code className="mt-1 inline-block rounded bg-surface px-1 py-0.5 text-[11px] text-muted">
                  {citation.path}
                </code>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium tracking-wide text-foreground">音源クレジット</h2>
          <p className="text-xs leading-6 text-muted/80">
            一部の効果音・環境音（雨・波の音、鐘・鈴・カリンバの単音）は Wikimedia Commons で
            公開されている実録音を、トリミングと音量調整のみ行って使用しています。
            Public Domain / CC0 の素材は表示不要のため省略し、CC BY・CC BY-SA の素材のみ記載します。
            合成音（ノイズ・パッド・拍）を含む全素材の出所は
            <code className="rounded bg-surface px-1 py-0.5 text-[11px]"> docs/ASSET_LICENSES.md</code> で管理しています。
          </p>
          <ul className="flex flex-col gap-4">
            {SOUND_CREDITS.map((credit) => (
              <li key={credit.url} className="border-l border-border pl-4">
                <a
                  href={credit.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {credit.title}
                </a>
                <p className="mt-1 text-xs leading-6 text-muted">
                  {credit.author} · {credit.license}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-4 pb-8">
          <h2 className="text-sm font-medium tracking-wide text-foreground">技術スタック</h2>
          <p className="text-sm leading-7 text-muted">
            Next.js（静的書き出し）・TypeScript・素の Web Audio API・Zustand・Tailwind CSS。
            サウンドの一部は開発用の合成音のプレースホルダーです。ライセンス台帳は
            <code className="rounded bg-surface px-1 py-0.5 text-[11px]"> docs/ASSET_LICENSES.md</code> で管理しています。
          </p>
        </section>
      </div>
    </div>
  );
}
