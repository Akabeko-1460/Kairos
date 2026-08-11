"use client";

interface TimerRingProps {
  progress: number; // 0..1
  label: string; // 'FOCUS' | 'BREAK' 等
  timeLabel: string; // 'mm:ss'
  accentColor: string;
}

const SIZE = 340;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TimerRing({ progress, label, timeLabel, accentColor }: TimerRingProps) {
  const offset = CIRCUMFERENCE * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={accentColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="tabular-nums text-6xl font-light">{timeLabel}</span>
        <span className="text-xs tracking-[0.3em] text-muted">{label}</span>
      </div>
    </div>
  );
}
