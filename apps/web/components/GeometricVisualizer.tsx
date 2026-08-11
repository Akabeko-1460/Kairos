"use client";

import { getVisualizerFrequencyData } from "@/lib/soundscapeRuntime";
import { useEffect, useRef } from "react";

interface GeometricVisualizerProps {
  /** 音が実際に鳴っているか。false のときは低振幅のアイドル呼吸パターンにフォールバックする。 */
  active: boolean;
  accentColor: string;
  /** リング状の幾何学模様の芯になる多角形の頂点数。フェーズごとに変えると印象が変わる。 */
  sides?: number;
  /** 放射ラインの基準半径（コンテナの短辺に対する比率）。TimerRing の外側に描く場合は大きめにする。 */
  innerRadiusRatio?: number;
  /** マスク（フェード）の内側/外側半径（コンテナに対するパーセント）。 */
  maskInnerPercent?: number;
  maskOuterPercent?: number;
}

const BIN_COUNT = 64; // getByteFrequencyData から間引いて使う本数（放射状の線の本数）
const FREQ_BUFFER_SIZE = 1024; // AnalyserNode.fftSize=1024 -> frequencyBinCount=512 を想定した上限

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [140, 140, 150];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/**
 * Endelにインスパイアされた「サウンドに合わせて動く幾何学アート」。
 * 実装・見た目ともにオリジナル: AnalyserNode の周波数データを放射状のライン長に、
 * 全体音量を中心の多角形の脈動に変換するだけの単純な仕組みで、Endel自身のレンダラーや
 * 意匠のコピーではない。
 */
export function GeometricVisualizer({
  active,
  accentColor,
  sides = 6,
  innerRadiusRatio = 0.19,
  maskInnerPercent = 0,
  maskOuterPercent = 85,
}: GeometricVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const [r, g, b] = hexToRgb(accentColor);
    const freqData = new Uint8Array(FREQ_BUFFER_SIZE / 2) as Uint8Array<ArrayBuffer>;
    let rafId = 0;
    let disposed = false;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
    resize();
    window.addEventListener("resize", resize);

    function draw(timeMs: number) {
      if (disposed || !canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const baseRadius = Math.min(w, h) * innerRadiusRatio;

      ctx.clearRect(0, 0, w, h);

      const hasLiveData = active && getVisualizerFrequencyData(freqData);
      const t = timeMs / 1000;

      // 放射状のライン（周波数スペクトラム）。データが無いときは緩やかな呼吸パターンで代替する。
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.05); // 全体をゆっくり回転させる
      for (let i = 0; i < BIN_COUNT; i++) {
        const angle = (i / BIN_COUNT) * Math.PI * 2;
        let amp: number;
        if (hasLiveData) {
          const binIndex = Math.floor((i / BIN_COUNT) * freqData.length * 0.5); // 低〜中域を中心に使う
          amp = freqData[binIndex]! / 255;
        } else {
          amp = 0.15 + 0.08 * Math.sin(t * 0.6 + i * 0.4);
        }
        const inner = baseRadius;
        const outer = baseRadius + amp * baseRadius * 1.1;
        const x1 = Math.cos(angle) * inner;
        const y1 = Math.sin(angle) * inner;
        const x2 = Math.cos(angle) * outer;
        const y2 = Math.sin(angle) * outer;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.15 + amp * 0.55})`;
        ctx.lineWidth = Math.max(1, w * 0.0015);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.restore();

      // 中心の多角形。全体音量（放射ラインの平均振幅）で脈動させる。
      let avgAmp = 0.2;
      if (hasLiveData) {
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i]!;
        avgAmp = sum / freqData.length / 255;
      } else {
        avgAmp = 0.18 + 0.04 * Math.sin(t * 0.5);
      }
      const polyRadius = baseRadius * (0.55 + avgAmp * 0.35);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.08);
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const x = Math.cos(angle) * polyRadius;
        const y = Math.sin(angle) * polyRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.35 + avgAmp * 0.3})`;
      ctx.lineWidth = Math.max(1, w * 0.002);
      ctx.stroke();
      ctx.restore();

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [active, accentColor, sides, innerRadiusRatio]);

  // closest-side を基準にすることで、パーセンテージが innerRadiusRatio と同じ単位
  // （コンテナ短辺の半分に対する比率）で扱えるようにする。
  const maskImage = `radial-gradient(circle closest-side at 50% 50%, transparent ${maskInnerPercent}%, black ${
    maskInnerPercent + 8
  }%, black ${maskOuterPercent}%, transparent 100%)`;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ maskImage, WebkitMaskImage: maskImage }}
    />
  );
}
