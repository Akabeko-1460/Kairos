"use client";

interface RoundIndicatorProps {
  currentRound: number;
  totalRounds: number;
  accentColor: string;
}

export function RoundIndicator({ currentRound, totalRounds, accentColor }: RoundIndicatorProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1.5">
        {Array.from({ length: totalRounds }, (_, i) => i + 1).map((round) => (
          <span
            key={round}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: round === currentRound ? accentColor : "var(--border)",
            }}
          />
        ))}
      </div>
      <span className="text-xs text-muted">
        Round {currentRound} of {totalRounds}
      </span>
    </div>
  );
}
