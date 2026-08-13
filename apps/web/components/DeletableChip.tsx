"use client";

interface DeletableChipProps {
  label: string;
  active: boolean;
  accentColor: string;
  /** 右クリックで削除できるか。最後の1件を消せなくするために呼び出し側が制御する。 */
  deletable: boolean;
  pendingDelete: boolean;
  onSelect: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  /** スクリーンリーダー向けの削除ボタンのラベル（例: 「25 / 5 を削除」）。 */
  deleteAriaLabel: string;
}

/**
 * 選択と「右クリック → ゴミ箱で削除」を兼ねるチップ。
 * Pomodoro のプリセットと Timer の分数プリセットで同じ操作感になるよう、
 * 見た目と挙動をここに1つだけ持つ（`usePendingDelete` と対で使う）。
 */
export function DeletableChip({
  label,
  active,
  accentColor,
  deletable,
  pendingDelete,
  onSelect,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  deleteAriaLabel,
}: DeletableChipProps) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          // ゴミ箱を出している最中の左クリックは「やめる」の意味にする（選択し直さない）。
          if (pendingDelete) {
            onCancelDelete();
            return;
          }
          onSelect();
        }}
        onContextMenu={(e) => {
          if (!deletable) return;
          e.preventDefault();
          onRequestDelete();
        }}
        className="rounded-full border px-4 py-1.5 text-xs"
        style={{
          borderColor: active ? accentColor : "var(--border)",
          color: active ? accentColor : "var(--muted)",
        }}
      >
        {label}
      </button>
      {pendingDelete && (
        <button
          type="button"
          aria-label={deleteAriaLabel}
          onClick={onConfirmDelete}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white shadow"
        >
          🗑
        </button>
      )}
    </div>
  );
}
