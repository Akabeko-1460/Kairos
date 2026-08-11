"use client";

import { useState } from "react";

interface CustomPresetModalProps {
  onClose: () => void;
  onCreate: (input: { focusMinutes: number; breakMinutes: number; roundsBeforeLongBreak: number }) => void;
}

export function CustomPresetModal({ onClose, onCreate }: CustomPresetModalProps) {
  const [focusMinutes, setFocusMinutes] = useState(45);
  const [breakMinutes, setBreakMinutes] = useState(8);
  const [rounds, setRounds] = useState(4);

  const valid = focusMinutes > 0 && breakMinutes > 0 && rounds > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onCreate({ focusMinutes, breakMinutes, roundsBeforeLongBreak: rounds });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6"
      >
        <h2 className="mb-1 text-sm font-medium text-foreground">カスタムポモドーロ</h2>
        <p className="mb-6 text-xs text-muted">Focus・Breakの時間とラウンド数を指定してください。</p>

        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between text-xs text-muted">
            Focus（分）
            <input
              type="number"
              name="focusMinutes"
              min={1}
              max={180}
              value={focusMinutes}
              onChange={(e) => setFocusMinutes(Number(e.target.value))}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-right text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-muted">
            Break（分）
            <input
              type="number"
              name="breakMinutes"
              min={1}
              max={60}
              value={breakMinutes}
              onChange={(e) => setBreakMinutes(Number(e.target.value))}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-right text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </label>
          <label className="flex items-center justify-between text-xs text-muted">
            長い休憩までのラウンド数
            <input
              type="number"
              name="roundsBeforeLongBreak"
              min={1}
              max={12}
              value={rounds}
              onChange={(e) => setRounds(Number(e.target.value))}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-right text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-1.5 text-xs text-foreground"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={!valid}
            className="rounded-full bg-focus-accent px-4 py-1.5 text-xs font-medium text-background disabled:opacity-50"
          >
            作成
          </button>
        </div>
      </form>
    </div>
  );
}
