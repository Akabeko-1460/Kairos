"use client";

import { create } from "zustand";
import type { VisualStyleId } from "./visualStyles";

export interface BackgroundArtConfig {
  active: boolean;
  styleId: VisualStyleId;
  accentColor: string;
  holeRadiusRatio: number;
  seed: number;
}

interface BackgroundArtStore {
  config: BackgroundArtConfig;
  setConfig: (config: BackgroundArtConfig) => void;
}

const DEFAULT_CONFIG: BackgroundArtConfig = {
  active: false,
  styleId: "chronos",
  accentColor: "#ffffff",
  holeRadiusRatio: 0,
  seed: 0,
};

/**
 * 画面全体（ヘッダーのタブも含む）で共有する、ただ1つの背景アート設定。
 * 各ページはこのストアへ「今どのモードをどんな強度で見せたいか」を書き込むだけで、
 * 実際の描画（GeometricVisualizer / WebGLシェーダー）はルートレイアウトで
 * 1つのcanvasとして継続的に走り続ける（ページ遷移をまたいでも再生成されない）。
 */
export const useBackgroundArtStore = create<BackgroundArtStore>((set) => ({
  config: DEFAULT_CONFIG,
  setConfig: (config) => set({ config }),
}));
