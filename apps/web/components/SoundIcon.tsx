"use client";

/**
 * Home画面のサウンド選択アイコン。Endelの実際のアイコン意匠は使わず、
 * 抽象的な幾何学モチーフのオリジナルSVGのみで構成する（docs/CLAUDE.md 禁止事項）。
 */
export type IconVariant =
  | "focus"
  | "break"
  | "crescent"
  | "prism"
  | "orbit"
  | "dots"
  | "leaf"
  | "droplets"
  | "waves"
  | "flow"
  | "peaks"
  | "spiral";

const PATHS: Record<IconVariant, React.ReactNode> = {
  focus: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  break: (
    <>
      <path d="M6 14c1.5-4 3.5-6 6-6s4.5 2 6 6" />
      <path d="M5 17.5c2-2.5 4.5-3.5 7-3.5s5 1 7 3.5" />
    </>
  ),
  crescent: <path d="M15 4a8 8 0 1 0 5 14 9 9 0 0 1-5-14Z" />,
  prism: <path d="M12 3 20 18H4Z" />,
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="4" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  dots: (
    <>
      {[4, 9, 14, 19].flatMap((y) =>
        [5, 10, 15, 20].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="0.9" fill="currentColor" stroke="none" />
        )),
      )}
    </>
  ),
  leaf: <path d="M6 19C6 10 11 4 19 4c0 8-5 14-13 15Zm0 0C6 14 9 10 13 8" />,
  droplets: (
    <>
      <path d="M9 4c2 3 3 5 3 7a3 3 0 1 1-6 0c0-2 1-4 3-7Z" />
      <path d="M16.5 10c1.3 2 2 3.3 2 4.7a2.5 2.5 0 1 1-5 0c0-1.4.7-2.7 3-4.7Z" />
    </>
  ),
  waves: (
    <>
      <path d="M3 9c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
      <path d="M3 15c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" />
    </>
  ),
  flow: <path d="M4 6h9a4 4 0 0 1 0 8H7a3 3 0 0 0 0 6h9" />,
  peaks: <path d="M3 18 8 8l4 6 3-4 6 8Z" />,
  spiral: <path d="M12 4a8 8 0 1 1-6 13 5.5 5.5 0 1 0 4-9.2A3.2 3.2 0 1 1 13 12" />,
};

interface SoundIconProps {
  variant: IconVariant;
  locked?: boolean;
  size?: number;
}

export function SoundIcon({ variant, locked = false, size = 22 }: SoundIconProps) {
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
        {PATHS[variant]}
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
