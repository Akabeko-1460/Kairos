"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
}

interface TaskListStore {
  items: TaskItem[];
  addItem: (text: string) => void;
  removeItem: (id: string) => void;
  toggleItem: (id: string) => void;
}

function createTaskId(): string {
  // crypto.randomUUID は古いブラウザ/非HTTPSコンテキストで使えないことがあるためフォールバックする。
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
          return { items: [...s.items, { id: createTaskId(), text: trimmed, done: false }] };
        }),
      removeItem: (id) => set((s) => ({ items: s.items.filter((item) => item.id !== id) })),
      toggleItem: (id) =>
        set((s) => ({
          items: s.items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)),
        })),
    }),
    // チェック機能の追加でデータ形式が string[] から TaskItem[] に変わったため、
    // 旧形式のローカルストレージと衝突しないようキーを更新する。
    { name: "kairos-task-list-v2" },
  ),
);
