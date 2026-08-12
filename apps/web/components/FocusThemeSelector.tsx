"use client";

import { SoundIcon } from "@/components/SoundIcon";
import { FOCUS_SOUND_THEMES } from "@/lib/soundThemes";
import type { SoundTheme } from "@/lib/soundThemes";
import type { ThemeId } from "@kairos/audio-engine";
import { motion } from "framer-motion";

interface FocusThemeSelectorProps {
  selectedId: ThemeId;
  onSelect: (id: ThemeId) => void;
  /** 省略時は Pomodoro の Focus 系テーマ（Study/Work/Move）のみ。Timer/Stopwatch は全5テーマを渡す。 */
  themes?: readonly SoundTheme[];
}

/**
 * サウンドテーマを選ぶUI。既定は Pomodoro の Focus フェーズで鳴らす/描くテーマ
 * （Study・Work・Move）のみだが、`themes` を渡せば任意のテーマ集合を選ばせられる
 * （/timer, /stopwatch は用途を限定しないため全5テーマを渡す）。
 * 選択結果は背景アート（lib/soundThemes.ts の visual/accent）にのみ反映し、
 * タイマーリングやボタンの配色（focus-accent/break-accent）は変えない。
 */
export function FocusThemeSelector({ selectedId, onSelect, themes = FOCUS_SOUND_THEMES }: FocusThemeSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {themes.map((theme) => {
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
