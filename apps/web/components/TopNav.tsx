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
            <Link key={tab.href} href={tab.href} className="px-1 py-1">
              <motion.span
                className="inline-block text-sm tracking-wide"
                initial={false}
                animate={{ color: active ? "#ededf0" : "#8b8b93", y: 0 }}
                whileHover={{ color: "#ededf0", y: -2 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
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
