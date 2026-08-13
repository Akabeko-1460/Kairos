"use client";

/**
 * 画面遷移をブラウザ標準の View Transitions API で滑らかにクロスフェードさせる。
 *
 * 経緯: 当初 framer-motion の AnimatePresence で「退出する旧画面」もアニメーションさせようと
 * したが、実機検証（chrome-devtools MCP でDOMを直接サンプリング）で機能していないことが
 * 判明した。Next.js App Router の `children` は内部的にルーターの状態を購読する共有ツリーで
 * あり、AnimatePresence が退出アニメーション用に「まだ生きたコンポーネントとして」保持し続ける
 * 「旧画面」も、実体は同じコンポーネントインスタンス（Context経由でルーター状態を読む）を
 * 指しているため、退出アニメーション中に再レンダリングされて中身が新画面のものへ
 * 書き換わってしまい、「新画面が新画面自身とクロスフェードする」という意味のない
 * 二重描画になっていた（旧画面の見た目は一切残らない）。
 *
 * React が「まだ生きたコンポーネント」として旧画面を保持し続ける限りこの問題は避けられない。
 * `document.startViewTransition()` はその逆で、DOM変更が起きる**前**にブラウザが旧画面を
 * ピクセルとして凍結スナップショットしてから変更を適用するため、Reactの再レンダリングには
 * 一切影響されない（凍結された画像でしかないので書き換わりようがない）。
 *
 * 当初 `run()` の後に独自で rAF を2回挟んで新画面の描画を待ってから解決させていたが、
 * 実機検証で「Transition was aborted because of timeout in DOM update」という
 * ブラウザ側のタイムアウトに毎回引っかかることが判明した。View Transition が
 * アクティブな間はこのアプリの背景（GeometricVisualizer 等の常時稼働する
 * requestAnimationFrame ループ）の影響で rAF の発火が乱れ、独自に待たせている
 * Promise がいつまでも解決しなかったと見られる。ブラウザは Promise を返さない
 * コールバックでも「次の描画」まで自動的に待つ仕様になっているため、自前の待機は
 * 不要かつ有害だった。`run` をそのまま渡すだけにする。
 *
 * TypeScript の DOM 型定義がまだ `startViewTransition` を含んでいないため、
 * このファイル内だけで型を補って扱う（グローバルな型汚染を避ける）。
 */
interface ViewTransition {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
}

type ViewTransitionCapableDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

export function isViewTransitionSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof (document as ViewTransitionCapableDocument).startViewTransition === "function"
  );
}

// 連打等で新しいナビゲーションが始まったら、進行中のトランジションはアニメーションだけ
// 打ち切る（DOM更新自体は止めない）。無視すると「前のトランジションがまだ終わっていない」
// 状態で新しいトランジションが割り込み、finished/ready が reject して
// unhandled rejection になることがある。
let activeTransition: ViewTransition | null = null;

/**
 * 「今まさに `navigateWithViewTransition` によるナビゲーションの最中か」を返す。
 * PageTransition.tsx がこれを見て、自前の framer-motion フェードと二重にアニメーション
 * しないよう自分を無効化する。Home/Credit のように `navigateWithViewTransition` を
 * 経由しないナビゲーションでは常に false のままなので、そちらは従来通り
 * framer-motion のフェードだけが効く。
 */
export function isNativeTransitionInFlight(): boolean {
  return activeTransition !== null;
}

/**
 * `run`（ルーティングの状態を変える処理、通常は `router.push`）を View Transition で包む。
 * 未対応ブラウザ（Safari 16.4 など、docs/02_SPEC.md の対応環境の一部）や
 * `prefers-reduced-motion` が有効な場合は素通しして即座にナビゲートする
 * （見た目は遷移前の状態に戻るだけで、悪化はしない）。
 */
export function navigateWithViewTransition(run: () => void): void {
  const prefersReducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const doc = document as ViewTransitionCapableDocument;
  if (!doc.startViewTransition || prefersReducedMotion) {
    run();
    return;
  }

  activeTransition?.skipTransition();

  const transition = doc.startViewTransition(run);
  activeTransition = transition;
  // ready/finished は「アニメーションが打ち切られた」等の想定内の理由でも reject しうる
  // （MDNもハンドル推奨）。ここで拾って unhandled rejection にしないことだけが目的で、
  // 失敗しても既に run() でナビゲーション自体は実行済みなのでユーザー体験への影響はない。
  transition.finished
    .catch(() => undefined)
    .finally(() => {
      if (activeTransition === transition) activeTransition = null;
    });
}

// isNativeTransitionInFlight と同じ仕組み（TopNav.tsx から navigateInstantly() 実行中だけ true）。
let instantNavigationPending = false;

/** 今まさに `navigateInstantly` によるナビゲーションの最中かを返す。 */
export function isInstantNavigationPending(): boolean {
  return instantNavigationPending;
}

/**
 * `navigateInstantly` が立てたフラグを、実際にその遷移を反映したレンダーが済んだ後で
 * PageTransition.tsx から呼んでもらう（pathname が変わるたびに呼ばれる useEffect 経由）。
 * これにより「本当にその遷移のレンダーが終わるまで」正確にフラグを保持できる
 * （固定時間のタイマーだと、レンダーが想定より遅れた場合に早く消えてしまい、
 * framer-motion のフェードが漏れて発動してしまう）。
 */
export function clearInstantNavigationPending(): void {
  instantNavigationPending = false;
}

/**
 * ロードを伴わない軽いナビゲーション（例: 既に Pomodoro/Timer/Stopwatch のいずれかにいる状態
 * からの切り替え）を、アニメーション無しで即座に行う。View Transition も
 * framer-motion のフェードもどちらも使わない（PageTransition.tsx がこのフラグを見て
 * 自身の描画を素通しする）。「Home からTimers系へ最初に入るときはこれまで通り
 * アニメーションさせたいが、Timers系同士の切り替えはロードが無いのでパッと切り替えたい」
 * という要望に応えるためのもの。
 */
export function navigateInstantly(run: () => void): void {
  instantNavigationPending = true;
  run();
  // 同じ URL への push など、pathname が実際には変わらず PageTransition の
  // useEffect（pathname依存）が発火しないケースの保険として、一定時間後にも念のため下ろす。
  setTimeout(() => {
    instantNavigationPending = false;
  }, 2000);
}
