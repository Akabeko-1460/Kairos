"use client";

import { getVisualizerFrequencyData } from "@/lib/soundscapeRuntime";
import { VISUAL_STYLES, type VisualStyleId } from "@/lib/visualStyles";
import { useEffect, useRef } from "react";

interface GeometricVisualizerProps {
  /** 音が実際に鳴っているか。false のときは低振幅のアイドル呼吸パターンにフォールバックする。 */
  active: boolean;
  accentColor: string;
  /** モードごとに全く異なる生成アートを描く（docs/CLAUDE.md: Endel意匠のコピー禁止、ゼロからの実装）。 */
  styleId: VisualStyleId;
  /** 画面中央を避けたい場合（TimerRing の裏側など）に、その半径分だけ内側を避ける（px）。 */
  holeRadiusRatio?: number;
  /** createState に渡すシード。変えるとレイアウト（星の位置・ノードの配置等）が変わる。 */
  seed?: number;
}

const FREQ_BUFFER_SIZE = 1024; // AnalyserNode.fftSize=1024 -> frequencyBinCount=512 を想定した上限
const AMP_SMOOTHING = 0.14; // 大きいほど振幅の反応が速くなる（0..1）

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [140, 140, 150];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

export function GeometricVisualizer({
  active,
  accentColor,
  styleId,
  holeRadiusRatio = 0,
  seed = 7,
}: GeometricVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // active は一時停止/再開のたびに変わるが、そのたびにパーティクル配置などを作り直したくないので
  // ref 経由で読む（このprop変化ではエフェクトを再実行しない）。
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const style = VISUAL_STYLES[styleId];
    const state = style.createState(seed);
    const rgb = hexToRgb(accentColor);
    const freqData = new Uint8Array(FREQ_BUFFER_SIZE / 2) as Uint8Array<ArrayBuffer>;
    let rafId = 0;
    let disposed = false;
    let lastTimeMs: number | null = null;
    let smoothedAmp = 0.2;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    resize();
    window.addEventListener("resize", resize);

    function bandAverage(data: Uint8Array, from: number, to: number): number {
      const start = Math.floor(data.length * Math.max(0, from));
      const end = Math.max(start + 1, Math.floor(data.length * Math.min(1, to)));
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i]!;
      return sum / (end - start) / 255;
    }

    function draw(timeMs: number) {
      if (disposed || !canvas || !ctx) return;
      const dt = lastTimeMs === null ? 0 : Math.min(0.1, (timeMs - lastTimeMs) / 1000);
      lastTimeMs = timeMs;

      const w = canvas.width;
      const h = canvas.height;
      const minDim = Math.min(w, h);

      const hasLiveData = activeRef.current && getVisualizerFrequencyData(freqData);
      const t = timeMs / 1000;

      let rawAmp = 0.16 + 0.06 * Math.sin(t * 0.4);
      if (hasLiveData) rawAmp = bandAverage(freqData, 0, 0.6);
      smoothedAmp += (rawAmp - smoothedAmp) * AMP_SMOOTHING;

      const band = (from: number, to: number) =>
        hasLiveData ? bandAverage(freqData, from, to) : 0.12 + 0.08 * Math.sin(t * 0.5 + from * 6);

      if (style.clearMode === "clear") {
        ctx.clearRect(0, 0, w, h);
      } else {
        // 前フレームをうっすら塗り重ねて軌跡を残す（背景色と同じ色をごく低アルファで重ねる）
        ctx.fillStyle = `rgba(10, 10, 12, ${style.fadeAlpha ?? 0.1})`;
        ctx.fillRect(0, 0, w, h);
      }

      style.draw(
        {
          ctx,
          w,
          h,
          cx: w / 2,
          cy: h / 2,
          minDim,
          maxDim: Math.max(w, h),
          t,
          dt,
          amp: smoothedAmp,
          band,
          rgb,
          hole: holeRadiusRatio * minDim,
        },
        state,
      );

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [accentColor, styleId, holeRadiusRatio, seed]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
