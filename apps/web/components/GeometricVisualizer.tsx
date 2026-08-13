"use client";

import { getVisualizerFrequencyData } from "@/lib/soundscapeRuntime";
import { VISUAL_STYLES, type VisualStyleId } from "@/lib/visualStyles";
import { useEffect, useRef } from "react";
import { ShaderVisualizer } from "./ShaderVisualizer";

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

/**
 * 背景（WebGLシェーダーによる、Endelを表現面で参考にした有機的に流れ続けるアート）と、
 * その上に重ねる精密な幾何学レイヤー（canvas 2D、lib/visualStyles.ts）の2層構成。
 * 前者が「常に何かが流れている」土台を、後者が「モードごとの構造・物語」を担う。
 */
export function GeometricVisualizer({
  active,
  accentColor,
  styleId,
  holeRadiusRatio = 0,
  seed = 7,
}: GeometricVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // active は一時停止/再開のたびに変わるが、そのたびにパーティクル配置などを作り直したくないので
  // ref 経由で読む（このprop変化ではエフェクトを再実行しない）。レンダー中の ref 書き換えは
  // React のルール違反になるため、専用の effect で同期する。
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });

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
        ctx.globalCompositeOperation = "source-over";
        ctx.clearRect(0, 0, w, h);
      } else {
        // このcanvasはシェーダー背景の上に重ねる透明レイヤーなので、不透明色で塗り重ねると
        // 背景を隠してしまう。destination-out で「うっすら消す」ことで軌跡だけを残す。
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0, 0, 0, ${style.fadeAlpha ?? 0.1})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over";
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

      scheduleNextFrame();
    }

    // タブが背面に回っている間は描画ループ自体を止める（ShaderVisualizer.tsx と同じ理由）。
    // ページ遷移のクロスフェード中は新旧2世代 × Shader/Geometric の最大4本の描画ループが
    // 同時稼働しうるため、非表示時に確実に止めておく効果が大きい。
    function scheduleNextFrame() {
      if (disposed || document.hidden) return;
      rafId = requestAnimationFrame(draw);
    }

    function handleVisibilityChange() {
      if (!document.hidden && !disposed) {
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(draw);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    scheduleNextFrame();
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("resize", resize);
    };
  }, [accentColor, styleId, holeRadiusRatio, seed]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <ShaderVisualizer active={active} styleId={styleId} holeRadiusRatio={holeRadiusRatio} />
      {/*
        mix-blend-mode: screen で下のシェーダー背景と加算的に溶け合わせる。
        不透明な重ね塗りだと「背景の上に別レイヤーが乗っている」ように見えてしまうが、
        screen 合成なら明るい線・粒子がシェーダーの光ににじむように馴染み、
        2つの描画技術が1つの作品として融合して見える。
      */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ mixBlendMode: "screen" }}
      />
    </div>
  );
}
