"use client";

import { SoundIcon } from "@/components/SoundIcon";
import { FOCUS_SOUND_THEMES } from "@/lib/soundThemes";
import { motion } from "framer-motion";

interface FocusThemeSelectorProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

/**
 * Pomodoro の Focus フェーズで鳴らす/描くサウンドテーマ（Study・Work・Move）を選ぶUI。
 * 選択結果は背景アート（lib/soundThemes.ts の visual/accent）にのみ反映し、
 * タイマーリングやボタンの配色（focus-accent/break-accent）は変えない。
 */
export function FocusThemeSelector({ selectedId, onSelect }: FocusThemeSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {FOCUS_SOUND_THEMES.map((theme) => {
        const active = theme.id === selectedId;
        return (
          <motion.button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme.id)}
            aria-label={theme.label}
            aria-pressed={active}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.94 }}
            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
            style={{
              borderColor: active ? theme.accent : "var(--border)",
              color: active ? theme.accent : "var(--muted)",
            }}
          >
            <SoundIcon variant={theme.icon} size={14} />
            {theme.label}
          </motion.button>
        );
      })}
    </div>
  );
}
