"use client";

import { usePresetsStore } from "@/hooks/usePresets";
import { CLASSIC_PRESET, DEEP_PRESET, type PomodoroPreset } from "@kairos/core";
import { useEffect, useState } from "react";
import { CustomPresetModal } from "./CustomPresetModal";

interface PresetSelectorProps {
  selectedId: string;
  accentColor: string;
  onSelect: (preset: PomodoroPreset) => void;
}

export function PresetSelector({ selectedId, accentColor, onSelect }: PresetSelectorProps) {
  const customPresets = usePresetsStore((s) => s.customPresets);
  const hiddenBuiltinIds = usePresetsStore((s) => s.hiddenBuiltinIds);
  const addCustomPreset = usePresetsStore((s) => s.addCustomPreset);
  const removeCustomPreset = usePresetsStore((s) => s.removeCustomPreset);
  const hideBuiltinPreset = usePresetsStore((s) => s.hideBuiltinPreset);

  const [showModal, setShowModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // ビルトイン(Classic/Deep)もカスタムプリセットと同じように右クリック削除できるようにする。
  // ビルトインは定数のため配列から取り除くのではなく hiddenBuiltinIds に載せて非表示にする。
  const builtinPresets = [CLASSIC_PRESET, DEEP_PRESET].filter((p) => !hiddenBuiltinIds.includes(p.id));
  const allPresets: PomodoroPreset[] = [...builtinPresets, ...customPresets];

  // 選択中のプリセットが（前回セッションで）削除済みで一覧に存在しない場合、先頭のプリセットへ
  // 自動でフォールバックする。customPresets/hiddenBuiltinIds が実際に変わったときだけ発火させる
  // （allPresets はレンダーのたびに新しい配列になるため、直接依存には含めない）。
  useEffect(() => {
    if (allPresets.some((p) => p.id === selectedId)) return;
    const fallback = allPresets[0];
    if (fallback) onSelect(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, customPresets, hiddenBuiltinIds]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allPresets.map((preset) => {
        const active = preset.id === selectedId;
        const pendingDelete = pendingDeleteId === preset.id;
        // 最後の1つは削除させない（プリセットが0件になるとPomodoroが選べなくなるため）。
        const deletable = allPresets.length > 1;
        return (
          <div key={preset.id} className="relative">
            <button
              type="button"
              onClick={() => {
                if (pendingDelete) {
                  setPendingDeleteId(null);
                  return;
                }
                onSelect(preset);
              }}
              onContextMenu={(e) => {
                if (!deletable) return;
                e.preventDefault();
                setPendingDeleteId(preset.id);
              }}
              className="rounded-full border px-4 py-1.5 text-xs"
              style={{
                borderColor: active ? accentColor : "var(--border)",
                color: active ? accentColor : "var(--muted)",
              }}
            >
              {preset.label}
            </button>
            {pendingDelete && (
              <button
                type="button"
                aria-label={`${preset.label} を削除`}
                onClick={() => {
                  const remaining = allPresets.filter((p) => p.id !== preset.id);
                  if (preset.isCustom) {
                    removeCustomPreset(preset.id);
                  } else {
                    hideBuiltinPreset(preset.id);
                  }
                  if (active) onSelect(remaining[0] ?? CLASSIC_PRESET);
                  setPendingDeleteId(null);
                }}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] text-white shadow"
              >
                🗑
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setShowModal(true)}
        aria-label="カスタムポモドーロを作成"
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-sm text-muted hover:text-foreground"
      >
        +
      </button>

      {showModal && (
        <CustomPresetModal
          onClose={() => setShowModal(false)}
          onCreate={(input) => {
            const preset = addCustomPreset(input);
            onSelect(preset);
          }}
        />
      )}
    </div>
  );
}
