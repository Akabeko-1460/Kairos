"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Home画面のサウンド選択アイコン。Endelの実際のアイコン意匠は使わず、
 * 抽象的な幾何学モチーフのオリジナルSVGのみで構成する（docs/CLAUDE.md 禁止事項）。
 */
export type IconVariant = "book" | "focus" | "break" | "crescent" | "motion";

const PATHS: Record<IconVariant, React.ReactNode> = {
  // Study: 開いた本
  book: (
    <>
      <path d="M12 6.5c-1.6-1.2-3.6-1.8-6-1.8v12.6c2.4 0 4.4.6 6 1.8" />
      <path d="M12 6.5c1.6-1.2 3.6-1.8 6-1.8v12.6c-2.4 0-4.4.6-6 1.8" />
      <path d="M12 6.5v12.6" />
    </>
  ),
  // Work: 的（集中）
  focus: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Relax: 息づく波
  break: (
    <>
      <path d="M6 14c1.5-4 3.5-6 6-6s4.5 2 6 6" />
      <path d="M5 17.5c2-2.5 4.5-3.5 7-3.5s5 1 7 3.5" />
    </>
  ),
  // Sleep: 三日月
  crescent: <path d="M15 4a8 8 0 1 0 5 14 9 9 0 0 1-5-14Z" />,
  // Move: 走る軌跡
  motion: (
    <>
      <path d="M4 17 10 11" />
      <path d="M8 17 13.5 8.5" />
      <path d="M12.5 17 18 6" />
      <circle cx="19" cy="5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
};

interface SoundIconProps {
  variant: IconVariant;
  locked?: boolean;
  size?: number;
}

export function SoundIcon({ variant, locked = false, size = 22 }: SoundIconProps) {
  const groupRef = useRef<SVGGElement>(null);
  const [offset, setOffset] = useState({ dx: 0, dy: 0 });

  // 手描きのパスはバウンディングボックスが (12,12) ちょうどに揃わないことが多いので、
  // 実測した図形の重心を viewBox の中心へ補正する（円ボタンの中で視覚的にズレて見える問題の対策）。
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    const bbox = g.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    setOffset({ dx: 12 - cx, dy: 12 - cy });
  }, [variant]);

  return (
    <span className="relative inline-flex">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={locked ? "opacity-40" : "opacity-90"}
      >
        <g ref={groupRef} transform={`translate(${offset.dx} ${offset.dy})`}>
          {PATHS[variant]}
        </g>
      </svg>
      {locked && (
        <svg
          width={9}
          height={9}
          viewBox="0 0 24 24"
          fill="currentColor"
          className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background p-[3px] text-muted"
        >
          <path d="M12 2a4 4 0 0 0-4 4v3H7a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm0 2a2 2 0 0 1 2 2v3h-4V6a2 2 0 0 1 2-2Z" />
        </svg>
      )}
    </span>
  );
}
