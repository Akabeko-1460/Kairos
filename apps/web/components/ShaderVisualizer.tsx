"use client";

import { getVisualizerFrequencyData } from "@/lib/soundscapeRuntime";
import { createShaderProgram, SHADER_PALETTES } from "@/lib/shaderVisual";
import type { VisualStyleId } from "@/lib/visualStyles";
import { useEffect, useRef } from "react";

interface ShaderVisualizerProps {
  active: boolean;
  styleId: VisualStyleId;
  holeRadiusRatio?: number;
}

const FREQ_BUFFER_SIZE = 512;
const AMP_SMOOTHING = 0.12;

export function ShaderVisualizer({ active, styleId, holeRadiusRatio = 0 }: ShaderVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { antialias: true, alpha: false });
    if (!gl) {
      console.warn("[Kairos] WebGL2 が利用できないため背景アートをスキップします。");
      return;
    }

    const program = createShaderProgram(gl);
    if (!program) return;

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    // フルスクリーンを覆う一枚の大三角形（クリッピングされる分は描画コスト無視できるほど軽い）
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const positionLoc = gl.getAttribLocation(program, "a_position");
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const uniforms = {
      resolution: gl.getUniformLocation(program, "u_resolution"),
      time: gl.getUniformLocation(program, "u_time"),
      amp: gl.getUniformLocation(program, "u_amp"),
      bass: gl.getUniformLocation(program, "u_bass"),
      treble: gl.getUniformLocation(program, "u_treble"),
      colorA: gl.getUniformLocation(program, "u_colorA"),
      colorB: gl.getUniformLocation(program, "u_colorB"),
      colorC: gl.getUniformLocation(program, "u_colorC"),
      baseFreq: gl.getUniformLocation(program, "u_baseFreq"),
      warpStrength: gl.getUniformLocation(program, "u_warpStrength"),
      flowSpeed: gl.getUniformLocation(program, "u_flowSpeed"),
      storyPeriod: gl.getUniformLocation(program, "u_storyPeriod"),
      patternType: gl.getUniformLocation(program, "u_patternType"),
      holeRadius: gl.getUniformLocation(program, "u_holeRadius"),
    };

    const freqData = new Uint8Array(FREQ_BUFFER_SIZE) as Uint8Array<ArrayBuffer>;
    let rafId = 0;
    let disposed = false;
    let smoothedAmp = 0.2;
    let smoothedBass = 0.2;
    let smoothedTreble = 0.2;

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
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
      if (disposed || !canvas || !gl) return;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);

      const palette = SHADER_PALETTES[styleId];
      const hasLiveData = activeRef.current && getVisualizerFrequencyData(freqData);
      const t = timeMs / 1000;

      let rawAmp = 0.15 + 0.05 * Math.sin(t * 0.35);
      let rawBass = rawAmp;
      let rawTreble = 0.15 + 0.05 * Math.sin(t * 0.5 + 1.5);
      if (hasLiveData) {
        rawAmp = bandAverage(freqData, 0, 0.6);
        rawBass = bandAverage(freqData, 0, 0.15);
        rawTreble = bandAverage(freqData, 0.4, 0.8);
      }
      smoothedAmp += (rawAmp - smoothedAmp) * AMP_SMOOTHING;
      smoothedBass += (rawBass - smoothedBass) * AMP_SMOOTHING;
      smoothedTreble += (rawTreble - smoothedTreble) * AMP_SMOOTHING;

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform1f(uniforms.time, t);
      gl.uniform1f(uniforms.amp, smoothedAmp);
      gl.uniform1f(uniforms.bass, smoothedBass);
      gl.uniform1f(uniforms.treble, smoothedTreble);
      gl.uniform3f(uniforms.colorA, ...palette.colorA);
      gl.uniform3f(uniforms.colorB, ...palette.colorB);
      gl.uniform3f(uniforms.colorC, ...palette.colorC);
      gl.uniform1f(uniforms.baseFreq, palette.baseFreq);
      gl.uniform1f(uniforms.warpStrength, palette.warpStrength);
      gl.uniform1f(uniforms.flowSpeed, palette.flowSpeed);
      gl.uniform1f(uniforms.storyPeriod, palette.storyPeriodSec);
      gl.uniform1i(uniforms.patternType, palette.patternType);
      gl.uniform1f(uniforms.holeRadius, holeRadiusRatio);

      gl.drawArrays(gl.TRIANGLES, 0, 3);

      rafId = requestAnimationFrame(draw);
    }

    rafId = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteBuffer(positionBuffer);
      if (vao) gl.deleteVertexArray(vao);
    };
  }, [styleId, holeRadiusRatio]);

  return <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />;
}
