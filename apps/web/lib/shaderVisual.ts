/**
 * Endelのプレイヤー（app.endel.io/player/focus）を「実装ではなく表現として」参考にした、
 * WebGL2 フラグメントシェーダーによる有機的に流れ続ける背景。
 *
 * 技術は Inigo Quilez が体系化し Shadertoy 等で広く使われる古典的な生成アート手法
 * 「ドメインワーピング（domain warping）された fBm（fractal Brownian motion）ノイズ」を
 * ゼロから実装したもの。Endel固有のシェーダーコードやアセットは一切使用していない
 * （docs/CLAUDE.md 禁止事項）。fBmを自身の座標へフィードバックして帯電・大理石状の
 * 有機的な模様を作る手法自体は特定企業に属さない一般的な数学的技法。
 *
 * 参考: https://www.mysimulator.uk/domain-warping/ (IQ の手法解説)
 *       https://thebookofshaders.com/13/ (fBm の基礎)
 */
import { STORY_PERIOD_SEC } from "./storyPeriods";
import type { VisualStyleId } from "./visualStyles";

export interface ShaderPalette {
  colorA: readonly [number, number, number]; // 深部の色
  colorB: readonly [number, number, number]; // 中間の色
  colorC: readonly [number, number, number]; // ハイライト色
  baseFreq: number;
  warpStrength: number;
  flowSpeed: number;
  storyPeriodSec: number; // このアート全体が「呼吸」する周期。0にはならない（常に何かが見えている）
  patternType: number; // 0=Study(格子構造) 1=Work(回路状の脈) 2=Relax(純粋な有機模様) 3=Sleep(疎らな瞬き) 4=Move(鋭いコントラスト)
}

function hexToUnit(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0.5, 0.5, 0.55];
  return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
}

export const SHADER_PALETTES: Record<VisualStyleId, ShaderPalette> = {
  lattice: {
    colorA: hexToUnit("#05070f"),
    colorB: hexToUnit("#2f4ad1"),
    colorC: hexToUnit("#9db4ff"),
    baseFreq: 1.6,
    warpStrength: 0.55,
    flowSpeed: 0.045,
    storyPeriodSec: STORY_PERIOD_SEC.lattice,
    patternType: 0,
  },
  network: {
    colorA: hexToUnit("#08060f"),
    colorB: hexToUnit("#5b3fd6"),
    colorC: hexToUnit("#c9b6ff"),
    baseFreq: 1.9,
    warpStrength: 0.7,
    flowSpeed: 0.06,
    storyPeriodSec: STORY_PERIOD_SEC.network,
    patternType: 1,
  },
  flow: {
    colorA: hexToUnit("#03100c"),
    colorB: hexToUnit("#1f8f6c"),
    colorC: hexToUnit("#9fe9cf"),
    baseFreq: 1.1,
    warpStrength: 0.95,
    flowSpeed: 0.03,
    storyPeriodSec: STORY_PERIOD_SEC.flow,
    patternType: 2,
  },
  starfield: {
    colorA: hexToUnit("#03040c"),
    colorB: hexToUnit("#2c2f80"),
    colorC: hexToUnit("#b9c1ff"),
    baseFreq: 1.3,
    warpStrength: 0.4,
    flowSpeed: 0.018,
    storyPeriodSec: STORY_PERIOD_SEC.starfield,
    patternType: 3,
  },
  trails: {
    colorA: hexToUnit("#0a0503"),
    colorB: hexToUnit("#c9720f"),
    colorC: hexToUnit("#ffd79a"),
    baseFreq: 2.3,
    warpStrength: 1.1,
    flowSpeed: 0.09,
    storyPeriodSec: STORY_PERIOD_SEC.trails,
    patternType: 4,
  },
};

export const VERTEX_SRC = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_amp;
uniform float u_bass;
uniform float u_treble;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;
uniform float u_baseFreq;
uniform float u_warpStrength;
uniform float u_flowSpeed;
uniform float u_storyPeriod;
uniform int u_patternType;
uniform float u_holeRadius;

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p *= 2.02;
    amplitude *= 0.5;
  }
  return value;
}

// IQ流ドメインワーピング: fbm の出力を座標オフセットとして自身へフィードバックする
vec2 warp(vec2 p, float t, float strength) {
  vec2 q = vec2(
    fbm(p + vec2(0.0, 0.0) + t * 0.6),
    fbm(p + vec2(5.2, 1.3) - t * 0.5)
  );
  vec2 r = vec2(
    fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.35),
    fbm(p + 4.0 * q + vec2(8.3, 2.8) - t * 0.28)
  );
  return p + strength * r;
}

// セルに一つずつ疎らな瞬き点を置く。ほとんどのセルは何も返さない（疎らさが「静けさ」を作る）。
float sparkle(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float h = hash(cell);
  if (h < 0.88) return 0.0;
  vec2 center = 0.5 + 0.3 * (vec2(hash(cell + 1.1), hash(cell + 3.7)) - 0.5);
  float d = length(f - center);
  float twinkle = 0.5 + 0.5 * sin(t * (1.5 + h * 3.0) + h * 40.0);
  return smoothstep(0.06, 0.0, d) * twinkle;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  float distFromCenter = length(uv);

  // storyPeriod 秒で全体が呼吸する。0まで落ちきらないので消失しない。
  float story = 0.62 + 0.38 * sin(u_time * (6.28318530718 / u_storyPeriod));
  float warpAmt = u_warpStrength * (0.68 + story * 0.5) * (0.75 + u_bass * 0.7);

  vec2 p = uv * u_baseFreq;
  float tt = u_time * u_flowSpeed;
  vec2 wp = warp(p, tt, warpAmt);

  float field = fbm(wp * 1.25 + tt * 0.4);
  float detail = fbm(wp * 3.05 - tt * 0.55);

  float mixA = smoothstep(0.15, 0.78, field);
  vec3 color = mix(u_colorA, u_colorB, mixA);

  float highlightAmt = smoothstep(0.55, 0.95, detail) * (0.45 + u_treble * 0.7);
  color = mix(color, u_colorC, highlightAmt);

  // パターンごとの表情付け
  if (u_patternType == 0) {
    // Study: 精密な格子が模様の上にうっすら重なる（構造・集中）
    vec2 gp = uv * 14.0;
    float grid = min(abs(fract(gp.x) - 0.5), abs(fract(gp.y) - 0.5));
    float gridLine = smoothstep(0.02, 0.0, grid) * smoothstep(0.2, 0.75, field) * 0.4;
    color += u_colorC * gridLine;
  } else if (u_patternType == 1) {
    // Work: 回路のような細い光の筋
    float vein = smoothstep(0.6, 0.63, detail) - smoothstep(0.63, 0.66, detail);
    color += u_colorC * vein * (0.6 + u_amp * 0.6);
  } else if (u_patternType == 3) {
    // Sleep: 疎らな瞬き（星）を重ねる
    float tw = sparkle(uv * 9.0 + 3.1, u_time);
    color += u_colorC * tw * 0.9;
  } else if (u_patternType == 4) {
    // Move: 鋭いコントラスト（エネルギッシュ）
    field = pow(field, 1.6 - u_amp * 0.4);
  }

  float vignette = smoothstep(1.15, 0.15, distFromCenter);
  float holeMask = u_holeRadius > 0.0 ? smoothstep(u_holeRadius * 0.7, u_holeRadius, distFromCenter) : 1.0;
  float glow = pow(clamp(field, 0.0, 1.0), 2.0) * (0.55 + u_amp * 0.9);

  vec3 finalColor = color * (0.32 + glow * 0.95) * vignette * story * holeMask;
  fragColor = vec4(finalColor, 1.0);
}
`;

export function createShaderProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  function compile(type: number, src: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[Kairos] shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vs = compile(gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[Kairos] shader link error:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
