"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type FormEvent } from "react";

interface CustomPresetModalProps {
  onClose: () => void;
  onCreate: (input: { focusMinutes: number; breakMinutes: number; roundsBeforeLongBreak: number }) => void;
}

interface FieldProps {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

// 数値入力。ガラスのように透けたトラック内に置くため、枠線ではなく下線＋淡いフォーカスグローで見せる。
//
// クリックした瞬間に表示を空にし、自由に半角数字を打ち込めるようにする（既存の数字を
// 選択・削除してから打ち直す手間をなくす）。矢印キーでの増減は type="number" のネイティブ
// 挙動にそのまま任せる（スピンボタンの見た目だけを .no-spinner で消す。CSSで見た目を消しても
// キーボード操作の increment/decrement 自体は消えない）。何も入力せずに他へフォーカスを
// 移した場合は、親のstateを一切更新していないため表示が自動的に元の値へ戻る。
function NumberField({ label, name, value, min, max, onChange }: FieldProps) {
  // null の間は「未編集」= value をそのまま表示する。文字列が入っている間は編集中の下書き。
  const [draft, setDraft] = useState<string | null>(null);
  const displayValue = draft ?? String(value);

  const handleChange = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") return; // 空の間は親のstateを更新しない(=まだ確定させない)
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) onChange(parsed);
  };

  return (
    <label className="flex items-center justify-between gap-4 text-xs text-muted">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        name={name}
        min={min}
        max={max}
        value={displayValue}
        onFocus={() => setDraft("")}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={() => setDraft(null)}
        className="no-spinner w-20 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-right text-sm text-foreground outline-none transition-colors focus:border-white/30 focus:bg-white/[0.07]"
      />
    </label>
  );
}

export function CustomPresetModal({ onClose, onCreate }: CustomPresetModalProps) {
  const [focusMinutes, setFocusMinutes] = useState(45);
  const [breakMinutes, setBreakMinutes] = useState(8);
  const [rounds, setRounds] = useState(4);

  const valid = focusMinutes > 0 && breakMinutes > 0 && rounds > 0;

  // Escape で閉じられるように（透けたモーダルはクリック対象が曖昧になりやすいため補助）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onCreate({ focusMinutes, breakMinutes, roundsBeforeLongBreak: rounds });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <motion.form
          onClick={(e) => e.stopPropagation()}
          onSubmit={handleSubmit}
          initial={{ opacity: 0, scale: 0.94, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-white/[0.045] p-6 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
        >
          {/* 上端にうっすら差す光。ガラスパネルらしい透け感のための装飾で、意味のある情報は持たない。 */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60"
            style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.08), transparent)" }}
          />

          <div className="relative">
            <h2 className="mb-1 text-sm font-medium text-foreground">カスタムポモドーロ</h2>
            <p className="mb-6 text-xs text-muted">Focus・Breakの時間とラウンド数を指定してください。</p>

            <div className="flex flex-col gap-4">
              <NumberField label="Focus（分）" name="focusMinutes" min={1} max={180} value={focusMinutes} onChange={setFocusMinutes} />
              <NumberField label="Break（分）" name="breakMinutes" min={1} max={60} value={breakMinutes} onChange={setBreakMinutes} />
              <NumberField
                label="長い休憩までのラウンド数"
                name="roundsBeforeLongBreak"
                min={1}
                max={12}
                value={rounds}
                onChange={setRounds}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <motion.button
                type="button"
                onClick={onClose}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-xs text-foreground transition-colors hover:bg-white/[0.08]"
              >
                キャンセル
              </motion.button>
              <motion.button
                type="submit"
                disabled={!valid}
                whileHover={valid ? { scale: 1.03 } : undefined}
                whileTap={valid ? { scale: 0.97 } : undefined}
                className="rounded-full bg-focus-accent px-4 py-1.5 text-xs font-medium text-background shadow-[0_0_16px_rgba(76,110,245,0.45)] disabled:opacity-50 disabled:shadow-none"
              >
                作成
              </motion.button>
            </div>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>
  );
}
