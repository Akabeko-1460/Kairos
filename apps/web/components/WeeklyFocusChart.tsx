import type { WeeklyFocusDay } from "@/lib/statsView";

/** Static SVG deliberately has no animation, including under prefers-reduced-motion. */
export function WeeklyFocusChart({ days }: { days: readonly WeeklyFocusDay[] }) {
  return (
    <figure aria-label="直近7日の集中時間">
      <svg viewBox="0 0 350 180" className="w-full text-muted" aria-hidden="true">
        <line x1="0" y1="150" x2="350" y2="150" className="stroke-border" />
        {days.map((day, index) => {
          const height = day.heightRatio * 130;
          const center = index * 50 + 25;
          return (
            <g key={day.date}>
              <rect x={center - 12} y={150 - height} width="24" height={height} rx="3" fill="currentColor" />
              <text x={center} y="173" textAnchor="middle" fontSize="11" fill="currentColor">{day.label}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        <ul>
          {days.map((day) => (
            <li key={day.date}>{day.date}: {day.focusTime}、完了 {day.completedPomodoros}回</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
