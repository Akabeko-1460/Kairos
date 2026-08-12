"use client";

import { useBackgroundArtStore, type BackgroundArtConfig } from "@/lib/backgroundArtStore";
import { useEffect, useState } from "react";
import { GeometricVisualizer } from "./GeometricVisualizer";

/** styleId/accentColor/seed が同じなら「見た目としては同じアート」とみなし、クロスフェードしない。 */
function layerKey(config: BackgroundArtConfig): string {
  return `${config.styleId}|${config.accentColor}|${config.seed}`;
}

const CROSSFADE_SEC = 0.9;

interface BackgroundArtSnapshot {
  key: string;
  layers: Array<{ key: string; config: BackgroundArtConfig }>;
}

/**
 * 画面全体（上部のタブも含む）に敷く、ただ1枚の背景アート。ルートレイアウトに1回だけ置く。
 * ページ側の境界で区切られないよう、position: fixed で常にビューポート全体を覆う。
 *
 * ページ遷移（Home⇄Pomodoro⇄Timer等）でテーマが変わると styleId/accentColor が切り替わるが、
 * GeometricVisualizer は内部で WebGL/canvas の状態を作り直すため、そのまま繋ぎ変えると
 * 色・模様が瞬時に切り替わって見える（PageTransitionが前面のコンテンツを滑らかにフェードさせて
 * いるのに、全画面を覆う背景だけ唐突に変わり「画面切り替えが滑らかでない」と感じる原因になっていた）。
 * 音のクロスフェード（等パワーカーブ）と同じ発想を背景アートにも適用し、直近の見た目を
 * 透明度でフェードアウトさせながら新しい見た目をフェードインさせる。2世代分だけ同時に
 * マウントし、フェード完了後に古い方を破棄する（WebGLコンテキストを無制限に増やさないため）。
 */
export function BackgroundArt() {
  const config = useBackgroundArtStore((s) => s.config);
  const key = layerKey(config);

  // レンダー中に config の変化へ合わせて layers を調整する（Reactの「propsの変化に合わせて
  // stateを調整する」公式パターン）。effect 内で同期的に setState する構成を避けられる。
  const [snapshot, setSnapshot] = useState<BackgroundArtSnapshot>(() => ({ key, layers: [{ key, config }] }));
  if (snapshot.key !== key) {
    // identity（styleId/accentColor/seed）が変わった → 直近のレイヤーはフェードアウト対象として
    // 残しつつ、新しいレイヤーを積む。
    setSnapshot({ key, layers: [...snapshot.layers, { key, config }] });
  } else {
    const lastLayer = snapshot.layers[snapshot.layers.length - 1];
    if (lastLayer && lastLayer.config !== config) {
      // identity は同じだが中身（active の on/off や holeRadiusRatio 等）だけ変わった →
      // 新しいレイヤーは作らず、末尾レイヤーの config だけ差し替える。
      const layers = snapshot.layers.slice(0, -1);
      layers.push({ key, config });
      setSnapshot({ key, layers });
    }
  }

  // クロスフェードが終わったら、最新のレイヤーだけを残して古いレイヤーのWebGLコンテキストを解放する。
  // タイマーというDOM外部のリソースを扱うので、ここは effect が適切
  // （setState はタイマーのコールバック内で行っており、effect本体で同期的には呼んでいない）。
  useEffect(() => {
    if (snapshot.layers.length <= 1) return;
    const timer = setTimeout(() => {
      setSnapshot((s) => (s.layers.length > 1 ? { key: s.key, layers: [s.layers[s.layers.length - 1]!] } : s));
    }, CROSSFADE_SEC * 1000 + 100);
    return () => clearTimeout(timer);
  }, [snapshot]);

  return (
    <div className="fixed inset-0 z-0">
      {snapshot.layers.map((layer, i) => {
        const isCurrent = i === snapshot.layers.length - 1;
        return (
          <div
            key={layer.key}
            className="absolute inset-0 transition-opacity ease-in-out"
            style={{ opacity: isCurrent ? 1 : 0, transitionDuration: `${CROSSFADE_SEC}s` }}
          >
            <GeometricVisualizer
              active={layer.config.active}
              accentColor={layer.config.accentColor}
              styleId={layer.config.styleId}
              holeRadiusRatio={layer.config.holeRadiusRatio}
              seed={layer.config.seed}
            />
          </div>
        );
      })}
    </div>
  );
}
