"use client";

import type { EngineDebugInfo } from "@/hooks/useSoundscape";

interface DebugPanelProps {
  debugInfo: EngineDebugInfo;
  wallClockNow: number;
}

/**
 * Phase 0 スパイク検証用の読み取り専用パネル（docs/05_IMPLEMENTATION_PLAN.md タスク0-2, 0-3）。
 *
 * 使い方: Start してこのパネルを開いたまま、タブを裏にして数分放置し、
 * 戻ってきたときに contextTime と nextCellEventTime が壁時計とほぼ同じだけ進んでいれば、
 * バックグラウンドタブでも先読みスケジューリングが途切れていない（スパイクB）ことが確認できる。
 */
export function DebugPanel({ debugInfo, wallClockNow }: DebugPanelProps) {
  if (!debugInfo) {
    return (
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-muted">
        エンジン未初期化。Start を押すと表示されます。
      </div>
    );
  }

  const cellLeadSec = debugInfo.nextCellEventTime !== null ? debugInfo.nextCellEventTime - debugInfo.contextTime : null;

  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 font-mono text-xs text-muted">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-muted/70">Phase 0 Debug</div>
      <dl className="grid grid-cols-2 gap-x-2 gap-y-1">
        <dt>wall clock</dt>
        <dd className="tabular-nums text-foreground">{new Date(wallClockNow).toLocaleTimeString("ja-JP")}</dd>

        <dt>ctx state</dt>
        <dd className="text-foreground">{debugInfo.contextState}</dd>

        <dt>ctx.currentTime</dt>
        <dd className="tabular-nums text-foreground">{debugInfo.contextTime.toFixed(2)}s</dd>

        <dt>current phase</dt>
        <dd className="text-foreground">{debugInfo.currentPhase ?? "-"}</dd>

        <dt>next cell in</dt>
        <dd className="tabular-nums text-foreground">
          {cellLeadSec !== null ? `${cellLeadSec.toFixed(2)}s` : "-"}
        </dd>
      </dl>
    </div>
  );
}
