"use client";

import { TimerToolsMenu, type TimerTool } from "@/components/TimerToolsMenu";
import { useCountdownStore } from "@/hooks/useCountdown";
import { useFreeplay } from "@/hooks/useFreeplay";
import { useStopwatchStore } from "@/hooks/useStopwatch";
import { navigateInstantly, navigateWithViewTransition } from "@/lib/viewTransition";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

const TABS = [{ href: "/", label: "Home" }] as const;
const TRAILING_TABS = [{ href: "/credit", label: "Credit" }] as const;

// Pomodoro / Timer(普通のカウントダウン) / Stopwatch をまとめる新しいナビ項目。
// 「Timers」ボタンを押すと3択の梯子状メニュー（TimerToolsMenu）がオーバーレイ表示される。
const TIMER_TOOLS: readonly TimerTool[] = [
  { href: "/pomodoro", label: "Pomodoro" },
  { href: "/timer", label: "Timer" },
  { href: "/stopwatch", label: "Stopwatch" },
];

/** Home/Credit/Timers 共通のホバーグロー＋色アニメーション。Link/button どちらの中身にも使う。 */
function NavItemContent({ label, active }: { label: string; active: boolean }) {
  return (
    <>
      {/* もわっと白く光るホバーグロー。ぼかした白い光暈をテキストの後ろに重ねて背景ごと明るくする。
          文字の外側まで大きく・強く広がるように、広がり幅(inset)・ぼかし(blur)・
          最大不透明度をいずれも底上げしている。 */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-[-28px] rounded-full bg-white"
        style={{ filter: "blur(22px)" }}
        initial={{ opacity: 0, scale: 0.8 }}
        whileHover={{ opacity: 0.65, scale: 1.25 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
      {/*
        上に上がる動きだと「浮く」印象になるため、y方向の移動はやめて手前に迫るような
        拡大（scale）だけで前進感を出す。ただし拡大幅は控えめにして、光の演出（上の
        グロー）の方を主役にする。
      */}
      <motion.span
        className="relative inline-block text-sm tracking-wide"
        initial={false}
        animate={{ color: active ? "#ededf0" : "#8b8b93", scale: 1 }}
        whileHover={{ color: "#ededf0", scale: 1.06 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ transformOrigin: "center" }}
      >
        {label}
      </motion.span>
    </>
  );
}

function NavLink({
  href,
  label,
  active,
  onClick,
}: {
  href: string;
  label: string;
  active: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}): ReactNode {
  return (
    <Link href={href} className="relative px-1 py-1" onClick={onClick}>
      <NavItemContent label={label} active={active} />
    </Link>
  );
}

const MENU_ANCHOR_GAP = 14; // Timers ボタンとメニュー上端の間隔

export function TopNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, stopFreeplay, ensureEngine } = useFreeplay();
  // Timer/Stopwatch は Pomodoro と違って mode を "timer" に切り替えず、Home と同じ
  // freeplay 再生をそのまま使い続ける。そのため mode だけを見て停止すると、計測中の
  // Timer/Stopwatch の音まで消してしまう（下記 handleHomeClick 参照）。
  const countdownStatus = useCountdownStore((s) => s.state.status);
  const stopwatchStatus = useStopwatchStore((s) => s.state.status);
  const timerToolInUse =
    countdownStatus === "running" ||
    countdownStatus === "paused" ||
    stopwatchStatus === "running" ||
    stopwatchStatus === "paused";
  const timersButtonRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);

  const timerToolsActive = TIMER_TOOLS.some((t) => pathname.startsWith(t.href));
  const activeTimerToolHref = TIMER_TOOLS.find((t) => pathname.startsWith(t.href))?.href ?? null;

  // TimerToolsMenu の項目は <Link> ではなく素の <button>（メニューの見た目上、位置合わせや
  // 開閉アニメーションの都合でLinkにしていない）のため、Next.js の自動プリフェッチが効かず、
  // クリックのたびに初回ナビゲーションの読み込みが発生していた。これが View Transition の
  // 「クリックしてから実際に新画面のスナップショットが撮れるまでの無音区間」を長引かせ、
  // アニメーションというより「ロードが挟まった」ように感じられる主因だったため、
  // マウント時に先読みしておく。
  useEffect(() => {
    for (const tool of TIMER_TOOLS) router.prefetch(tool.href);
  }, [router]);

  // Home タブは「最初の Kairos 表示に戻る」ボタンとしても機能させる。
  // ただし計測中のタイマーの音まで止めてはいけない。
  //
  // Pomodoro は Start すると mode が "timer" になるので mode を見るだけで避けられるが、
  // Timer/Stopwatch は計測中も mode が "freeplay" のままなので、mode だけを条件にすると
  // 計測中の音を止めてしまう。しかも Timer/Stopwatch 側には復帰経路が無い
  // （プレビュー再生の effect は idle のときだけ動き、"Resume Audio" ボタンは
  // エンジン未初期化のときだけ出る）ため、一度止まると Reset するまで無音のままになる。
  // そこで実際にタイマーが動いている（一時停止中も含む）間は停止しない。
  const handleHomeClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (mode === "freeplay" && !timerToolInUse) stopFreeplay();
    // Timers メニュー（handleSelectTool）と同じくブラウザ標準の View Transitions API で
    // クロスフェードさせる（lib/viewTransition.ts）。修飾キー付きクリック・中クリックは
    // ブラウザ標準の「新しいタブで開く」等の挙動を優先し、横取りしない。
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    navigateWithViewTransition(() => router.push("/"));
  };

  const handleOpenToolsMenu = () => {
    const rect = timersButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // メニューはボタンの真下・水平中央に出す（translateX(-50%) で中央合わせする前提の left）。
    setMenuAnchor({ top: rect.bottom + MENU_ANCHOR_GAP, left: rect.left + rect.width / 2 });
  };

  const handleSelectTool = (href: string) => {
    setMenuAnchor(null);
    // Timer/Stopwatch は画面に入った瞬間からプレビュー音を鳴らす仕様（各ページの useEffect）。
    // AudioContext はユーザー操作起点でしか作れない（ADR-003）ため、その操作をこのクリックに
    // 前倒しして用意しておく（同期的な呼び出しなのでジェスチャー扱いのまま渡る）。
    ensureEngine().catch((err: unknown) => console.error("[Kairos] SoundscapeEngine error:", err));
    // 既に Pomodoro/Timer/Stopwatch のいずれかにいる状態からの切り替えは、prefetch済みで
    // 追加のロードを伴わない軽い遷移なので、View Transition の「奥へ退く/奥から浮き上がる」
    // 演出を使わず即座に切り替える。Home 等から Timers 系へ最初に入るときだけ、
    // これまで通りアニメーションさせる（timerToolsActive で判定）。
    if (timerToolsActive) {
      navigateInstantly(() => router.push(href));
    } else {
      navigateWithViewTransition(() => router.push(href));
    }
  };

  return (
    <>
      <header className="flex w-full items-center justify-center px-8 pb-4 pt-8">
        <nav className="flex items-center gap-6">
          {TABS.map((tab) => (
            <NavLink
              key={tab.href}
              href={tab.href}
              label={tab.label}
              active={pathname === tab.href}
              onClick={handleHomeClick}
            />
          ))}

          <button ref={timersButtonRef} type="button" className="relative px-1 py-1" onClick={handleOpenToolsMenu}>
            <NavItemContent label="Timers" active={timerToolsActive} />
          </button>

          {TRAILING_TABS.map((tab) => (
            <NavLink key={tab.href} href={tab.href} label={tab.label} active={pathname.startsWith(tab.href)} />
          ))}
        </nav>
      </header>

      <AnimatePresence>
        {menuAnchor && (
          <TimerToolsMenu
            tools={TIMER_TOOLS}
            activeHref={activeTimerToolHref}
            anchor={menuAnchor}
            onSelect={handleSelectTool}
            onClose={() => setMenuAnchor(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
