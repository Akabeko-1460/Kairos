"use client";

function VolumeIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
    </svg>
  );
}

interface VolumeSliderProps {
  value: number;
  onChange: (v: number) => void;
  /** つまみの色。省略時は --muted に従う。 */
  accentColor?: string;
  className?: string;
}

/**
 * Home/Pomodoro共通の音量バー。エンジンはページを跨いだシングルトンなので、
 * どちらの画面でも同じマスター音量（lib/soundscapeRuntime.ts）を操作する。
 */
export function VolumeSlider({ value, onChange, accentColor, className }: VolumeSliderProps) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <span className="text-muted">
        <VolumeIcon />
      </span>
      <input
        type="range"
        name="masterVolume"
        aria-label="音量"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="subtle-slider w-full"
        style={accentColor ? { color: accentColor } : undefined}
      />
    </div>
  );
}
