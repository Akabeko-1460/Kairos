"use client";

import { useBackgroundArtStore } from "@/lib/backgroundArtStore";
import { GeometricVisualizer } from "./GeometricVisualizer";

/**
 * 画面全体（上部のタブも含む）に敷く、ただ1枚の背景アート。ルートレイアウトに1回だけ置く。
 * ページ側の境界で区切られないよう、position: fixed で常にビューポート全体を覆う。
 */
export function BackgroundArt() {
  const config = useBackgroundArtStore((s) => s.config);

  return (
    <div className="fixed inset-0 z-0">
      <GeometricVisualizer
        active={config.active}
        accentColor={config.accentColor}
        styleId={config.styleId}
        holeRadiusRatio={config.holeRadiusRatio}
        seed={config.seed}
      />
    </div>
  );
}
