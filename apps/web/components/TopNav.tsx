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
      <nav className="flex items-center gap-1">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative rounded-full px-4 py-1.5 text-xs tracking-wide transition-colors ${
                active ? "text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="top-nav-active-pill"
                  className="absolute inset-0 rounded-full bg-surface"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
