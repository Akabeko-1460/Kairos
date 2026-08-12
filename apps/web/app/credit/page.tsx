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

// サウンドの設計判断（テーマごとの scale/bpm/automation、環境軸の補正など）の背景にある
// 一次情報のみを掲載する。深層調査（Deep Research）レポート自体ではなく、その調査が
// 参照した原論文・記事・Endelの一次情報を、タイトルの ABC 順に並べる。
const REFERENCES = [
  {
    title: "Arousal, Mood, and the Mozart Effect",
    meta: "Thompson, W. F., Schellenberg, E. G., & Husain, G. (2001). Psychological Science, 12(3), 248–251.",
    note: "テンポや明るさが「覚醒度」と「気分」を介してパフォーマンスへ影響するという知見。テーマごとのbpm設計の背景。",
    url: "https://pubmed.ncbi.nlm.nih.gov/11437309/",
  },
  {
    title:
      "Can Music Influence Cardiac Autonomic System? A Systematic Review and Narrative Synthesis to Evaluate Its Impact on Heart Rate Variability",
    meta: "Mojtabavi, H., et al. (2020). Complementary Therapies in Clinical Practice, 39, 101162.",
    note: "音楽が副交感神経活動・心拍変動を高める傾向があるという系統的レビュー。Relaxの設計背景。",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S1744388119302889",
  },
  {
    title:
      "Cognitive Performance, Creativity and Stress Levels of Neurotypical Young Adults Under Different White Noise Levels",
    meta: "Scientific Reports, 12, 14113 (2022).",
    note: "45dB前後の弱めのホワイトノイズが持続的注意・創造性を高め、ストレスも低いという知見。ノイズ音量設計の背景。",
    url: "https://www.nature.com/articles/s41598-022-18862-w",
  },
  {
    title: "The Effect of Music Listening on Work Performance",
    meta: "Lesiuk, T. (2005). Psychology of Music, 33(2), 173–191.",
    note: "音楽聴取が気分と作業の質を高めるという知見。Workのリズム設計の背景。",
    url: "https://journals.sagepub.com/doi/abs/10.1177/0305735605050650",
  },
  {
    title:
      "Effects of the Alpha, Beta, and Gamma Binaural Beat Brain Stimulation and Short-Term Training on Simultaneously Assessed Visuospatial and Verbal Working Memories, Signal Detection Measures, Response Times, and Intrasubject Response Time Variabilities",
    meta: "Rakhshan, M., et al. (2022). BioMed Research International, 2022, 8588272.",
    note: "周波数帯ごとの脳波エントレインメントと作業記憶への影響を検証した臨床試験。",
    url: "https://onlinelibrary.wiley.com/doi/10.1155/2022/8588272",
  },
  {
    title: "Endel — Focus Timer",
    meta: "endel.io",
    note: "ポモドーロ・テクニックに基づくシナリオ機能。本プロジェクトの直接の参照元。",
    url: "https://endel.io/focus",
  },
  {
    title: "Endel — Science",
    meta: "endel.io",
    note: "Focus/Relax/Sleepそれぞれの音響設計原則（一定のビート、自然音によるマスキング等）の一次情報。",
    url: "https://endel.io/science",
  },
  {
    title: "Endel — Technology",
    meta: "endel.io",
    note: "サウンドスケープ生成エンジンの構造（Inputs / Core AI Logic / Sound generation / Output）についての一次情報。",
    url: "https://endel.io/technology",
  },
  {
    title: "Is Noise Always Bad? Exploring the Effects of Ambient Noise on Creative Cognition",
    meta: "Mehta, R., Zhu, R. (Juliet), & Cheema, A. (2012). Journal of Consumer Research, 39(4), 784–799.",
    note: "70dB前後の中程度の環境音が抽象的思考・創造性を高めるという知見。Relax/Studyの音量設計の背景。",
    url: "https://academic.oup.com/jcr/article-abstract/39/4/784/1798283",
  },
  {
    title: "Listening to Music for Insomnia in Adults",
    meta: "Jespersen, K. V., Pando-Naude, V., Koenig, J., Jennum, P., & Vuust, P. (2022). Cochrane Database of Systematic Reviews, Issue 8, CD010459.",
    note: "60〜85BPM程度の音楽を1日25〜50分聴くと主観的な睡眠の質が改善するというコクランレビュー。Sleep再構築の中心的根拠。",
    url: "https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD010459.pub3/full",
  },
  {
    title:
      "Measuring and Modeling the Effect of Audio on Human Focus in Everyday Environments Using Brain-Computer Interface Technology",
    meta: "Arctop, Inc., et al. (2021). Frontiers in Computational Neuroscience, 15, 760561.",
    note: "Endelのサウンドスケープが、プレイリストや無音と比較して集中の持続性を高めると報告する査読付き研究。",
    url: "https://www.frontiersin.org/journals/computational-neuroscience/articles/10.3389/fncom.2021.760561/full",
  },
  {
    title: "The Mechanism of the Irrelevant Speech Effect in Reading: A Systematic Review and Three-Level Meta-Analysis",
    meta: "ResearchGate (2023).",
    note: "理解可能な音声（歌詞・会話）が読解などの言語処理を強く妨げるという知見。Studyでリズムを持たせなかった背景。",
    url: "https://www.researchgate.net/publication/409450034_The_mechanism_of_the_irrelevant_speech_effect_in_reading_a_systematic_review_and_three-level_meta-analysis",
  },
  {
    title:
      "Music Listening and Stress Recovery in Healthy Individuals: A Systematic Review with Meta-Analysis of Experimental Studies",
    meta: "Adiasto, K., Beckers, D. G. J., van Hooff, M. L. M., Roelofs, K., & Geurts, S. A. E. (2022). PLOS ONE, 17(6), e0270031.",
    note: "音楽聴取後のストレス回復効果を検証した系統的レビュー・メタ分析。Relaxの設計背景。",
    url: "https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0270031",
  },
  {
    title: "Noise as a Sleep Aid: A Systematic Review",
    meta: "Riedy, S. M., Smith, M. G., Rocha, S., & Basner, M. (2021). Sleep Medicine Reviews, 55, 101385.",
    note: "白色雑音の睡眠補助としてのエビデンスは質が低いという系統的レビュー。Sleepで持続的なノイズ再生を避けた背景。",
    url: "https://www.sciencedirect.com/science/article/abs/pii/S1087079220301283",
  },
  {
    title: "Of Cricket Chirps and Car Horns: The Effect of Nature Sounds on Cognitive Performance",
    meta: "Van Hedger, S. C., et al. (2019). Psychonomic Bulletin & Review, 26(2), 522–530.",
    note: "都市音と比較して自然音が短時間でも指向的注意を高めるという知見。Study/Relaxの音素材選定の背景。",
    url: "https://pubmed.ncbi.nlm.nih.gov/30367351/",
  },
  {
    title: "Pink Noise Reduces REM Sleep and May Harm Sleep Quality",
    meta: "Penn Medicine News",
    note: "継続的なピンクノイズがREM睡眠を短縮しうるという知見。Sleepで「刺激を段階的に減らし静寂へ近づける」設計にした直接的根拠。",
    url: "https://www.pennmedicine.org/news/pink-noise-reduces-rem-sleep-and-may-harm-sleep-quality",
  },
  {
    title:
      "Real-Time Electroencephalography-Guided Binaural Beat Audio Enhances Relaxation and Cognitive Performance: A Randomized, Double-Blind, Sham-Controlled Repeated-Measures Crossover Trial",
    meta: "NeuroSci (MDPI), 5(4), 44 (2025).",
    note: "リスナーの状態にリアルタイムで適応する音響介入の一例。天気・時間帯・経過時間による補正の着想の背景。",
    url: "https://www.mdpi.com/2673-9488/5/4/44",
  },
  {
    title: "Slower Tempo Makes Worse Performance? The Effect of Musical Tempo on Cognitive Processing Speed",
    meta: "Lin, H.-M., Kuo, S.-H., & Mai, T. P. (2023). Frontiers in Psychology, 14, 998460.",
    note: "遅すぎるテンポの音楽が処理速度・成績を低下させるという知見。テーマごとのテンポ設計全般の背景。",
    url: "https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.998460/full",
  },
  {
    title: "Sony's New Headphones Boast Endel's Generative Soundscapes",
    meta: "TechCrunch (2022)",
    note: "「ステムベースのサウンドスケープを、アルゴリズムが組み立てる」というエンジンの実体についての共同創業者インタビュー。",
    url: "https://techcrunch.com/2022/05/20/endel-sony-partnership/",
  },
  {
    title: "Spotlight on: Spatial Audio",
    meta: "Apple Developer",
    note: "EndelがCore Audio / AVFoundationを用いたネイティブ実装であることの一次情報。",
    url: "https://developer.apple.com/news/?id=0vz78ua8",
  },
  {
    title:
      "Systematic Review and Meta-Analysis: Do White Noise and Pink Noise Help With Attention in Attention-Deficit/Hyperactivity Disorder?",
    meta: "(2024)",
    note: "白色・ピンクノイズが注意持続を助ける効果は個人の神経基盤（ADHD特性の有無）によって正反対になりうるというメタ分析。",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11283987/",
  },
];

export default function CreditPage() {
  return (
    <div className="flex flex-1 justify-center px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex w-full max-w-2xl flex-col gap-14">
        <section className="flex flex-col gap-4">
          <h1 className="text-2xl font-medium text-foreground">Kairos について</h1>
          <p className="text-sm leading-7 text-muted">
            Kairos は、集中フェーズと休憩フェーズに合わせて生成されるサウンドスケープを組み合わせた
            ポモドーロタイマーです。機械的に区切られ、淡々と過ぎていく時間（Chronos）を、
            質の高い集中と回復のための意味ある時間（Kairos）へと変えることを目指しています。
          </p>
          <p className="text-sm leading-7 text-muted">
            サウンドはStudy（読書・学習）・Work（PC作業・創造的作業）・
            Move（運動）・Relax（リラックス）・Sleep（睡眠）という5つのテーマに分かれており、
            それぞれ調・テンポ・音色・展開のロジックが異なります。同じテーマでも、
            天気や時間帯、サウンドを流し続けている経過時間に応じてゆっくりと補正され、
            同じ設定でも毎回わずかに違う展開になります。
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
              <span className="text-foreground">Timers</span> —
              Pomodoro・Timer（カウントダウン）・Stopwatchの3つから選べます。
            </li>
            <li className="pl-4 text-xs text-muted/80">
              <span className="text-foreground/80">Pomodoro</span> —
              プリセット（25/5・50/10、または独自のカスタム設定）を選んでセッションを開始します。
              プリセットは右クリックで削除でき、集中と休憩は自動で
              交互に切り替わり、フェーズ切替時に音がクロスフェードします。
            </li>
            <li className="pl-4 text-xs text-muted/80">
              <span className="text-foreground/80">Timer / Stopwatch</span> —
              Timerは好きな分数を指定してカウントダウンし、Stopwatchは経過時間を計測します。
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium tracking-wide text-foreground">音源クレジット</h2>
          <p className="text-xs leading-6 text-muted/80">
            一部の効果音・環境音（雨・波の音、鐘・鈴・カリンバの単音）は Wikimedia Commons で
            公開されている実録音を、トリミングと音量調整のみ行って使用しています。
            Public Domain / CC0 の素材は表示不要のため省略し、CC BY・CC BY-SA の素材のみ記載します。
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
          <h2 className="text-sm font-medium tracking-wide text-foreground">参考文献</h2>
          <p className="text-xs leading-6 text-muted/80">
            Kairosの音響設計
            （scale・bpm・automation や、天気・時間帯・経過時間による補正）は、以下の情報を
            根拠にしています。タイトルのABC順に並べています。
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
                <p className="mt-1 text-xs leading-6 text-muted/80">{ref.meta}</p>
                <p className="mt-1 text-xs leading-6 text-muted">{ref.note}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
