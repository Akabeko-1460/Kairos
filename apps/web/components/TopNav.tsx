"use client";

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
    <header className="flex w-full items-center justify-between border-b border-border px-8 py-4">
      <span className="text-sm font-medium tracking-wide text-foreground">Kairos</span>
      <nav className="flex items-center gap-1">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`rounded-full px-4 py-1.5 text-xs tracking-wide transition-colors ${
                active ? "bg-surface text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
