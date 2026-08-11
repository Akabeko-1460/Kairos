"use client";

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

  return (
    <header className="flex w-full items-center justify-center px-8 pb-4 pt-8">
      <nav className="flex items-center gap-6">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} className="relative px-1 py-1">
              {/* うっすらもわっと白く光るホバーグロー。ぼかした白い光暈をテキストの後ろに重ねる。 */}
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-[-14px] rounded-full bg-white"
                style={{ filter: "blur(14px)" }}
                initial={{ opacity: 0, scale: 0.85 }}
                whileHover={{ opacity: 0.32, scale: 1.15 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              />
              {/*
                上に上がる動きだと「浮く」印象になるため、y方向の移動はやめて手前に迫るような
                拡大（scale）だけで前進感を出す。文字そのものにも柔らかい白いにじみを足す。
              */}
              <motion.span
                className="relative inline-block text-sm tracking-wide"
                initial={false}
                animate={{ color: active ? "#ededf0" : "#8b8b93", scale: 1 }}
                whileHover={{ color: "#ededf0", scale: 1.14 }}
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
