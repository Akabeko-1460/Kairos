"use client";

import { getVisualizerFrequencyData } from "@/lib/soundscapeRuntime";
import { useEffect, useRef } from "react";

interface GeometricVisualizerProps {
  /** 音が実際に鳴っているか。false のときは低振幅のアイドル呼吸パターンにフォールバックする。 */
  active: boolean;
  accentColor: string;
  /** 幾何学模様の芯になる多角形の頂点数。カテゴリごとに変えると印象が変わる。 */
  sides?: number;
  /** 画面中央を避けたい場合（TimerRing の裏側など）に、その半径分だけ内側を透明に抜く（0〜1、コンテナ短辺に対する比率）。 */
  holeRadiusRatio?: number;
}

const FREQ_BUFFER_SIZE = 1024; // AnalyserNode.fftSize=1024 -> frequencyBinCount=512 を想定した上限

/** 同心円のリングを複数重ねる。半径・線本数・回転速度・帯域をずらして単調にならないようにする。 */
const RINGS = [
  { radiusRatio: 0.16, bins: 48, rotSpeed: 0.05, ampScale: 1.3, bandStart: 0.0, bandEnd: 0.35, widthScale: 1.0 },
  { radiusRatio: 0.27, bins: 64, rotSpeed: -0.03, ampScale: 1.0, bandStart: 0.1, bandEnd: 0.5, widthScale: 0.8 },
  { radiusRatio: 0.4, bins: 40, rotSpeed: 0.018, ampScale: 0.7, bandStart: 0.0, bandEnd: 0.25, widthScale: 0.6 },
] as const;

/** ゆったり漂うパーティクル層。Endelのアンビエントな質感を意識した補助レイヤー。 */
const PARTICLE_COUNT = 36;
interface Particle {
  angle: number;
  radiusRatio: number;
  speed: number;
  size: number;
  phase: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [140, 140, 150];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function makeParticles(seed: number): Particle[] {
  // 決定的にしておくと再マウントのたびに配置が飛ばず落ち着いて見える。
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 10000) / 10000;
  };
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    angle: rng() * Math.PI * 2,
    radiusRatio: 0.15 + rng() * 0.75,
    speed: 0.02 + rng() * 0.05,
    size: 0.6 + rng() * 1.8,
    phase: rng() * Math.PI * 2,
  }));
}

/**
 * Endelにインスパイアされた「サウンドに合わせて動く幾何学アート」。画面を広く使い、
 * 複数のリング + 漂うパーティクルを重ねた、より力強く動的な構成にしている。
 * 実装・見た目ともにオリジナル: AnalyserNode の周波数データをライン長・パーティクルの明滅に
 * 変換するだけの単純な仕組みで、Endel自身のレンダラーや意匠のコピーではない。
 */
export function GeometricVisualizer({
  active,
  accentColor,
  sides = 6,
  holeRadiusRatio = 0,
}: GeometricVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>(makeParticles(7));

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

    function bandAverage(data: Uint8Array, from: number, to: number): number {
      const start = Math.floor(data.length * from);
      const end = Math.max(start + 1, Math.floor(data.length * to));
      let sum = 0;
      for (let i = start; i < end; i++) sum += data[i]!;
      return sum / (end - start) / 255;
    }

    function draw(timeMs: number) {
      if (disposed || !canvas || !ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const minDim = Math.min(w, h);
      const maxDim = Math.max(w, h);
      const hole = holeRadiusRatio * minDim;

      ctx.clearRect(0, 0, w, h);

      const hasLiveData = active && getVisualizerFrequencyData(freqData);
      const t = timeMs / 1000;

      // 全体の呼吸（低振幅のアイドル状態でも完全な静止画にしない）
      let overallAmp = 0.18 + 0.05 * Math.sin(t * 0.4);
      if (hasLiveData) {
        overallAmp = bandAverage(freqData, 0, 0.6);
      }

      // --- 同心円のリング群 ---
      for (const ring of RINGS) {
        const baseRadius = Math.max(hole + 4, minDim * ring.radiusRatio);
        let bandAmpBase = 0;
        if (hasLiveData) bandAmpBase = bandAverage(freqData, ring.bandStart, ring.bandEnd);

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * ring.rotSpeed);
        for (let i = 0; i < ring.bins; i++) {
          const angle = (i / ring.bins) * Math.PI * 2;
          let amp: number;
          if (hasLiveData) {
            const binIndex = Math.floor(
              (ring.bandStart + (i / ring.bins) * (ring.bandEnd - ring.bandStart)) * freqData.length,
            );
            amp = freqData[Math.min(freqData.length - 1, binIndex)]! / 255;
          } else {
            amp = 0.12 + 0.1 * Math.sin(t * 0.5 + i * 0.5 + ring.radiusRatio * 10);
          }
          const inner = baseRadius;
          const outer = baseRadius + amp * baseRadius * ring.ampScale;
          const x1 = Math.cos(angle) * inner;
          const y1 = Math.sin(angle) * inner;
          const x2 = Math.cos(angle) * outer;
          const y2 = Math.sin(angle) * outer;
          const alpha = (0.1 + amp * 0.5) * (0.55 + bandAmpBase * 0.45);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.lineWidth = Math.max(1, minDim * 0.0016 * ring.widthScale);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // --- 中心の多角形。全体音量で脈動させる ---
      const polyBase = Math.max(hole + 4, minDim * 0.1);
      const polyRadius = polyBase * (0.7 + overallAmp * 0.6);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.07);
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const x = Math.cos(angle) * polyRadius;
        const y = Math.sin(angle) * polyRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.3 + overallAmp * 0.35})`;
      ctx.lineWidth = Math.max(1, minDim * 0.002);
      ctx.stroke();
      ctx.restore();

      // --- 漂うパーティクル層 ---
      ctx.save();
      ctx.translate(cx, cy);
      for (const p of particlesRef.current) {
        const angle = p.angle + t * p.speed;
        const radius = Math.max(hole + 8, p.radiusRatio * maxDim * 0.5);
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.6 + p.phase + overallAmp * 3));
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius * 0.72; // わずかに楕円軌道にして単調な円運動を避ける
        ctx.beginPath();
        ctx.arc(x, y, p.size * (minDim / 900) * (0.7 + overallAmp * 0.8), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.12 + twinkle * 0.28})`;
        ctx.fill();
      }
      ctx.restore();

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, [active, accentColor, sides, holeRadiusRatio]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
