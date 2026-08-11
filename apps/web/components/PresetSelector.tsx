"use client";

import { usePresetsStore } from "@/hooks/usePresets";
import { CLASSIC_PRESET, DEEP_PRESET, type PomodoroPreset } from "@kairos/core";
import { useState } from "react";
import { CustomPresetModal } from "./CustomPresetModal";

interface PresetSelectorProps {
  selectedId: string;
  accentColor: string;
  onSelect: (preset: PomodoroPreset) => void;
}

export function PresetSelector({ selectedId, accentColor, onSelect }: PresetSelectorProps) {
  const customPresets = usePresetsStore((s) => s.customPresets);
  const addCustomPreset = usePresetsStore((s) => s.addCustomPreset);
  const removeCustomPreset = usePresetsStore((s) => s.removeCustomPreset);

  const [showModal, setShowModal] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const allPresets: PomodoroPreset[] = [CLASSIC_PRESET, DEEP_PRESET, ...customPresets];

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {allPresets.map((preset) => {
        const active = preset.id === selectedId;
        const pendingDelete = pendingDeleteId === preset.id;
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
                if (!preset.isCustom) return;
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
                  removeCustomPreset(preset.id);
                  if (active) onSelect(CLASSIC_PRESET);
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
