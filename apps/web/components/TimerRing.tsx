"use client";

interface TimerRingProps {
  progress: number; // 0..1
  label: string; // 'FOCUS' | 'BREAK' 等
  timeLabel: string; // 'mm:ss'
  accentColor: string;
}

const SIZE = 340; // SVG viewBox の基準サイズ。実際の表示サイズは CSS 側で可変にする（下記 DISPLAY_SIZE）。
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/**
 * 340px を上限に、画面幅から左右88px（ページの px-8 余白 + 呼吸幅）を引いた分まで縮む。
 * vw基準にすることで、祖先が flex の shrink-to-fit で幅未確定でも確実に解決できる
 * （% 基準だと祖先の幅が auto のとき解決できない）。414px幅未満のスマホでのみ縮み、
 * それ以上（iPad・PC）では常に340pxで従来と同じ見た目になる。
 */
const DISPLAY_SIZE = "min(340px, calc(100vw - 88px))";

export function TimerRing({ progress, label, timeLabel, accentColor }: TimerRingProps) {
  // 残り時間を表すリングにするため、開始時（progress=0）は全周を色で囲み、
  // 時間の経過（progress→1）とともに描画範囲を減らして消えていくようにする。
  const offset = CIRCUMFERENCE * Math.min(1, Math.max(0, progress));

  return (
    <div className="relative" style={{ width: DISPLAY_SIZE, aspectRatio: "1 / 1" }}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-full w-full -rotate-90">
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
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-1"
        style={{
          background: "radial-gradient(circle, var(--background) 45%, transparent 72%)",
        }}
      >
        {/* text-6xl(60px)を上限に、リングが縮む幅に合わせて時刻表示も縮める。 */}
        <span className="tabular-nums font-light" style={{ fontSize: "clamp(2.25rem, 11vw, 3.75rem)" }}>
          {timeLabel}
        </span>
        <span className="text-xs tracking-[0.3em] text-muted">{label}</span>
      </div>
    </div>
  );
}
