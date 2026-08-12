"use client";

import { motion } from "framer-motion";
import { useEffect } from "react";

export interface TimerTool {
  readonly href: string;
  readonly label: string;
}

interface TimerToolsMenuProps {
  tools: readonly TimerTool[];
  activeHref: string | null;
  onSelect: (href: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 224;
const RUNG_HEIGHT = 56;
const RUNG_GAP = 22; // 「少し間隔を空けて配置」— 長方形どうしの隙間

/**
 * Pomodoro / Timer / Stopwatch を選ぶオーバーレイメニュー。
 * 画面全体をぼかし(backdrop-blur)、その上に「梯子」状のボタン列を重ねて表示する:
 * 各ボタンは白文字・上下だけ白い罫線（横棒 = 梯子の踏み桟）を持ち、罫線を持たない左右の辺は
 * コンテナ全体を貫く2本の縦棒（梯子の側木）が代わりに担う。ボタン間の隙間では横棒が途切れ、
 * 縦棒だけが繋がって見える。
 */
export function TimerToolsMenu({ tools, activeHref, onSelect, onClose }: TimerToolsMenuProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="タイマーの種類を選択"
        className="relative flex flex-col"
        style={{ width: MENU_WIDTH, gap: RUNG_GAP }}
        initial={{ opacity: 0, y: -16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 梯子の側木。ボタン間の隙間もまたいでコンテナの全高を貫く */}
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-px bg-white/80" />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-px bg-white/80" />

        {tools.map((tool, i) => {
          const active = tool.href === activeHref;
          return (
            <motion.button
              key={tool.href}
              type="button"
              onClick={() => onSelect(tool.href)}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
              whileHover={{ backgroundColor: "rgba(255,255,255,0.08)" }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center justify-center border-y border-white/80 text-sm tracking-[0.2em] text-white"
              style={{ height: RUNG_HEIGHT }}
            >
              {tool.label.toUpperCase()}
              {active && <span className="ml-2 h-1 w-1 rounded-full bg-white" aria-hidden />}
            </motion.button>
          );
        })}
      </motion.div>
    </motion.div>
  );
}
