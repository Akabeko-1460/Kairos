"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TaskListStore {
  items: string[];
  addItem: (text: string) => void;
  removeItem: (index: number) => void;
}

/**
 * 「このセッションで取り組むタスク」の箇条書きリスト。タイマーのフェーズ遷移とは無関係な
 * ただのメモなので @kairos/core には置かず、web 側のローカル永続ストアとして持つ。
 */
export const useTaskListStore = create<TaskListStore>()(
  persist(
    (set) => ({
      items: [],
      addItem: (text) =>
        set((s) => {
          const trimmed = text.trim();
          if (!trimmed) return s;
          return { items: [...s.items, trimmed] };
        }),
      removeItem: (index) => set((s) => ({ items: s.items.filter((_, i) => i !== index) })),
    }),
    { name: "kairos-task-list" },
  ),
);
