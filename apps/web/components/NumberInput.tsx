"use client";

import { useState, type InputHTMLAttributes } from "react";

type NumberInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "onFocus" | "onBlur"
> & {
  value: number;
  onChange: (v: number) => void;
};

/**
 * クリック（フォーカス）した瞬間に表示を空にし、自由に半角数字を打ち込める数値入力。
 * 矢印キーでの increment/decrement は type="number" のネイティブ挙動にそのまま任せ、
 * クリックで押せるスピンボタンの見た目だけを .no-spinner（globals.css）で消す。
 * 何も入力せずに他へフォーカスを移した場合は、親の state を一切更新していないため
 * 表示が自動的に元の値へ戻る。CustomPresetModal（Focus/Break/ラウンド数）と
 * Timer（カスタム分数）で共有する。
 */
export function NumberInput({ value, onChange, className, ...rest }: NumberInputProps) {
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
    <input
      type="number"
      inputMode="numeric"
      value={displayValue}
      onFocus={() => setDraft("")}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => setDraft(null)}
      className={`no-spinner ${className ?? ""}`}
      {...rest}
    />
  );
}
