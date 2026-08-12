"use client";

import { useFreeplay } from "@/hooks/useFreeplay";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Home" },
  { href: "/pomodoro", label: "Pomodoro" },
  { href: "/credit", label: "Credit" },
] as const;

export function TopNav() {
  const pathname = usePathname();
  const { mode, stopFreeplay } = useFreeplay();

  // Home タブは「最初の Kairos 表示に戻る」ボタンとしても機能させる。
  // Pomodoro のタイマー再生中（mode === "timer"）まで止めてしまうと音が切れてしまうため、
  // Home画面の自由再生（freeplay）が鳴っているときだけリセットする。
  const handleHomeClick = () => {
    if (mode === "freeplay") stopFreeplay();
  };

  return (
    <header className="flex w-full items-center justify-center px-8 pb-4 pt-8">
      <nav className="flex items-center gap-6">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="relative px-1 py-1"
              onClick={tab.href === "/" ? handleHomeClick : undefined}
            >
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
                {tab.label}
              </motion.span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
