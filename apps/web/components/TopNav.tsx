"use client";

import { TimerToolsMenu, type TimerTool } from "@/components/TimerToolsMenu";
import { useFreeplay } from "@/hooks/useFreeplay";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";

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

function NavLink({ href, label, active, onClick }: { href: string; label: string; active: boolean; onClick?: () => void }): ReactNode {
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
  const { mode, stopFreeplay } = useFreeplay();
  const timersButtonRef = useRef<HTMLButtonElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ top: number; left: number } | null>(null);

  const timerToolsActive = TIMER_TOOLS.some((t) => pathname.startsWith(t.href));
  const activeTimerToolHref = TIMER_TOOLS.find((t) => pathname.startsWith(t.href))?.href ?? null;

  // Home タブは「最初の Kairos 表示に戻る」ボタンとしても機能させる。
  // Pomodoro/Timer/Stopwatch のタイマー再生中（mode === "timer"）まで止めてしまうと
  // 音が切れてしまうため、Home画面の自由再生（freeplay）が鳴っているときだけリセットする。
  const handleHomeClick = () => {
    if (mode === "freeplay") stopFreeplay();
  };

  const handleOpenToolsMenu = () => {
    const rect = timersButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // メニューはボタンの真下・水平中央に出す（translateX(-50%) で中央合わせする前提の left）。
    setMenuAnchor({ top: rect.bottom + MENU_ANCHOR_GAP, left: rect.left + rect.width / 2 });
  };

  const handleSelectTool = (href: string) => {
    setMenuAnchor(null);
    router.push(href);
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
