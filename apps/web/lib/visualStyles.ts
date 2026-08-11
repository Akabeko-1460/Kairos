import { createNoise3D } from "simplex-noise";

/**
 * モードごとに全く異なる「ストーリー性のある」生成アートを描く。
 * 単一の幾何学を動かすだけでなく、複数のパーツ（構造・粒子・波・深度レイヤー等）を組み合わせ、
 * 時間経過で「散らばり→収束→静止→解放」のような明確な物語の起伏を持たせている。
 * Endelの実際のレンダラーやアセットは一切参照しておらず、古典的な生成アート技法
 * （スピログラフ/ハイポトロコイド、フローフィールド、力学風ネットワーク、リサージュ曲線、
 * 星空+視差深度）をゼロから実装したもの。サウンドの周波数データで振幅・速度・明滅を駆動する。
 */

export type VisualStyleId = "lattice" | "network" | "flow" | "starfield" | "trails";

export interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  cx: number;
  cy: number;
  minDim: number;
  maxDim: number;
  t: number; // seconds, monotonic
  dt: number; // seconds since previous frame
  amp: number; // 0..1、平滑化済みの全体振幅
  band: (from: number, to: number) => number; // 0..1、帯域ごとの平均振幅
  rgb: readonly [number, number, number];
  hole: number; // px。TimerRing 等を避けたい場合の内側半径
}

export function rgba([r, g, b]: readonly [number, number, number], a: number): string {
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 物語の時間軸を作るための共通ヘルパー ---
function easeInOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}
function easeOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - c, 3);
}
/** t を period 秒で 0..1 に正規化する周期位相。 */
function cyclePhase(t: number, period: number): number {
  const m = t % period;
  return (m < 0 ? m + period : m) / period;
}
/** center を頂点にした三角形のパルス（0..1）。width の範囲外は 0。 */
function smoothPulse(x: number, center: number, width: number): number {
  const d = Math.abs(x - center);
  return Math.max(0, 1 - d / width);
}

/** 各スタイルの背景クリア方式。'fade' はうっすら塗り重ねて軌跡を残す。 */
export interface VisualStyle<S> {
  clearMode: "clear" | "fade";
  fadeAlpha?: number;
  createState(seed: number): S;
  draw(f: Frame, state: S): void;
}

// ============================================================================
// Study — 「散漫 → 収束 → 精密 → 解放」。集中が立ち上がってくる様子を物語にする。
// ハイポトロコイド（スピログラフ）+ 精密な目盛りリング + 収束する粒子群。
// ============================================================================

interface LatticeCurveSpec {
  k: number; // R/r の整数比。この比にすると th: 0→2π で綺麗に閉じる
  rRatio: number;
  dRatio: number;
  speed: number;
}
interface LatticeParticle {
  scatterAngle: number;
  scatterRadius: number; // minDim に対する比率
  curveIndex: number;
  curveTh: number;
  driftSpeed: number;
}
interface LatticeState {
  curves: LatticeCurveSpec[];
  particles: LatticeParticle[];
}

const LATTICE_CURVES: LatticeCurveSpec[] = [
  { k: 7, rRatio: 0.3, dRatio: 0.55, speed: 0.05 },
  { k: 5, rRatio: 0.2, dRatio: 0.72, speed: -0.08 },
  { k: 11, rRatio: 0.42, dRatio: 0.32, speed: 0.025 },
];
const STUDY_PERIOD = 22; // 秒。1サイクル分の「集中が立ち上がる」物語の長さ

function hypotrochoidPoint(R: number, r: number, d: number, th: number): [number, number] {
  const x = (R - r) * Math.cos(th) + d * Math.cos(((R - r) / r) * th);
  const y = (R - r) * Math.sin(th) - d * Math.sin(((R - r) / r) * th);
  return [x, y];
}

export const latticeStyle: VisualStyle<LatticeState> = {
  clearMode: "clear",
  createState(seed) {
    const rng = mulberry32(seed);
    const particles: LatticeParticle[] = Array.from({ length: 64 }, () => ({
      scatterAngle: rng() * Math.PI * 2,
      scatterRadius: 0.3 + rng() * 0.5,
      curveIndex: Math.floor(rng() * LATTICE_CURVES.length),
      curveTh: rng() * Math.PI * 2,
      driftSpeed: 0.02 + rng() * 0.02,
    }));
    return { curves: LATTICE_CURVES, particles };
  },
  draw(f, state) {
    const { ctx, cx, cy, minDim, t, amp, band, rgb, hole } = f;
    const phase = cyclePhase(t, STUDY_PERIOD);

    // 物語: 0-0.28 散漫 / 0.28-0.55 収束 / 0.55-0.85 精密に静止 / 0.85-1.0 解放
    let converge: number;
    if (phase < 0.28) converge = 0;
    else if (phase < 0.55) converge = easeInOutCubic((phase - 0.28) / 0.27);
    else if (phase < 0.85) converge = 1;
    else converge = 1 - easeInOutCubic((phase - 0.85) / 0.15);

    ctx.save();
    ctx.translate(cx, cy);

    // 精密な目盛りリング（収束するほどはっきり見える）
    const tickCount = 108;
    const tickBaseR = Math.max(hole + minDim * 0.02, minDim * 0.47);
    ctx.lineWidth = 1;
    for (let i = 0; i < tickCount; i++) {
      const a = (i / tickCount) * Math.PI * 2 + t * 0.015;
      const major = i % 9 === 0;
      const bandAmp = band(0.5, 0.9);
      const len = (major ? 0.05 : 0.02) * minDim * (0.5 + bandAmp * 0.8);
      const r0 = tickBaseR;
      const r1 = tickBaseR + len;
      ctx.strokeStyle = rgba(rgb, (major ? 0.4 + bandAmp * 0.3 : 0.14) * (0.25 + converge * 0.75));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }

    // ハイポトロコイド曲線（構造。収束が進むほど濃く）
    for (const [i, c] of state.curves.entries()) {
      const R = Math.max(hole + minDim * 0.04, c.rRatio * minDim);
      const r = R / c.k;
      const curveAmp = band(i * 0.2, i * 0.2 + 0.4);
      const d = r * c.dRatio * (0.75 + curveAmp * 0.5 + amp * 0.15);
      const steps = 480;
      ctx.save();
      ctx.rotate(t * c.speed);
      ctx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const th = (s / steps) * Math.PI * 2;
        const [x, y] = hypotrochoidPoint(R, r, d, th);
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = rgba(rgb, (0.28 + curveAmp * 0.32) * (0.2 + converge * 0.8));
      ctx.lineWidth = Math.max(0.8, minDim * 0.0011);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // 粒子群: 散らばった位置から、曲線上の一点へ収束する
    for (const p of state.particles) {
      const curve = state.curves[p.curveIndex]!;
      const R = Math.max(hole + minDim * 0.04, curve.rRatio * minDim);
      const r = R / curve.k;
      const d = r * curve.dRatio * 0.9;
      // targetAngle に t*curve.speed を織り込んでいるため、曲線自体の回転（draw側のctx.rotate）と
      // 同じだけ点も進む。ctx.rotate は適用していない座標系なのでそのまま使える。
      const targetAngle = t * curve.speed + p.curveTh;
      const [tx, ty] = hypotrochoidPoint(R, r, d, targetAngle);

      const sx = Math.cos(p.scatterAngle + t * p.driftSpeed) * p.scatterRadius * minDim * 0.5;
      const sy = Math.sin(p.scatterAngle + t * p.driftSpeed) * p.scatterRadius * minDim * 0.42;

      const x = cx + sx + (tx - sx) * converge;
      const y = cy + sy + (ty - sy) * converge;
      const size = Math.max(0.8, minDim * 0.0016) * (0.7 + converge * 1.1);
      const alpha = 0.12 + converge * 0.55 + amp * 0.08;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, alpha);
      ctx.fill();
    }
  },
};

// ============================================================================
// Work — 「成長の波」が中心から外へ繰り返し広がる、プロジェクトが育つ物語。
// 固定トポロジーのノード網 + 外へ広がる成長波 + 辺を伝うパルス。
// ============================================================================

interface NetworkNode {
  ring: number;
  baseAngle: number;
  speed: number;
  wobbleSeed: number;
}
interface NetworkEdge {
  a: number;
  b: number;
}
interface NetworkPulse {
  edge: number;
  progress: number;
  speed: number;
}
interface NetworkState {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  pulses: NetworkPulse[];
  rng: () => number;
}

const NETWORK_RINGS = [0.15, 0.26, 0.38, 0.48];
const NETWORK_COUNTS = [5, 7, 9, 11];
const WORK_WAVE_PERIOD = 9; // 成長の波が中心から外へ広がる周期（秒）

export const networkStyle: VisualStyle<NetworkState> = {
  clearMode: "clear",
  createState(seed) {
    const rng = mulberry32(seed);
    const nodes: NetworkNode[] = [];
    const ringStartIndex: number[] = [];
    for (let ring = 0; ring < NETWORK_RINGS.length; ring++) {
      ringStartIndex.push(nodes.length);
      const count = NETWORK_COUNTS[ring]!;
      for (let i = 0; i < count; i++) {
        nodes.push({
          ring,
          baseAngle: (i / count) * Math.PI * 2 + rng() * 0.3,
          speed: (0.02 + rng() * 0.03) * (rng() < 0.5 ? 1 : -1),
          wobbleSeed: rng() * 100,
        });
      }
    }
    const edges: NetworkEdge[] = [];
    for (let ring = 0; ring < NETWORK_RINGS.length; ring++) {
      const start = ringStartIndex[ring]!;
      const count = NETWORK_COUNTS[ring]!;
      for (let i = 0; i < count; i++) edges.push({ a: start + i, b: start + ((i + 1) % count) });
    }
    for (let ring = 0; ring < NETWORK_RINGS.length - 1; ring++) {
      const start = ringStartIndex[ring]!;
      const count = NETWORK_COUNTS[ring]!;
      const nextStart = ringStartIndex[ring + 1]!;
      const nextCount = NETWORK_COUNTS[ring + 1]!;
      for (let i = 0; i < count; i++) {
        const j = Math.floor((i / count) * nextCount);
        edges.push({ a: start + i, b: nextStart + j });
      }
    }
    const pulses: NetworkPulse[] = Array.from({ length: 10 }, () => ({
      edge: Math.floor(rng() * edges.length),
      progress: rng(),
      speed: 0.15 + rng() * 0.2,
    }));
    return { nodes, edges, pulses, rng };
  },
  draw(f, state) {
    const { ctx, cx, cy, minDim, t, dt, amp, band, rgb, hole } = f;
    const positions = state.nodes.map((n) => {
      const angle = n.baseAngle + t * n.speed;
      const wobble = 1 + 0.015 * Math.sin(t * 0.4 + n.wobbleSeed);
      const r = Math.max(hole + minDim * 0.03, NETWORK_RINGS[n.ring]! * minDim * wobble);
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
    });

    // 成長の波: 中心から外へ繰り返し広がり、通過した辺・ノードを明るくする
    const wavePhase = cyclePhase(t, WORK_WAVE_PERIOD);
    const waveRadius = easeOutCubic(wavePhase) * minDim * 0.56;
    const waveBand = minDim * 0.09;

    const edgeAmp = band(0.05, 0.4);
    ctx.lineWidth = Math.max(0.7, minDim * 0.0009);
    for (const e of state.edges) {
      const [x1, y1] = positions[e.a]!;
      const [x2, y2] = positions[e.b]!;
      const midR = (Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - cx, y2 - cy)) / 2;
      const waveHit = smoothPulse(midR, waveRadius, waveBand);
      ctx.strokeStyle = rgba(rgb, 0.07 + edgeAmp * 0.14 + waveHit * 0.4);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // パルス: 辺の上を移動する光点（プロジェクトが常に動いている質感）
    for (const p of state.pulses) {
      p.progress += dt * p.speed * (0.6 + amp * 1.2);
      if (p.progress >= 1) {
        p.progress = 0;
        p.edge = Math.floor(state.rng() * state.edges.length);
      }
      const e = state.edges[p.edge]!;
      const [x1, y1] = positions[e.a]!;
      const [x2, y2] = positions[e.b]!;
      const x = x1 + (x2 - x1) * p.progress;
      const y = y1 + (y2 - y1) * p.progress;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, minDim * 0.0022), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.75);
      ctx.fill();
    }

    // ノード本体（波が通過した瞬間に一段明るく光る）
    for (const [i, pos] of positions.entries()) {
      const node = state.nodes[i]!;
      const localAmp = band(node.ring * 0.15, node.ring * 0.15 + 0.3);
      const r = Math.hypot(pos[0] - cx, pos[1] - cy);
      const waveHit = smoothPulse(r, waveRadius, waveBand);
      const radius = Math.max(1.6, minDim * 0.004) * (0.7 + localAmp * 0.7 + waveHit * 0.6);
      ctx.beginPath();
      ctx.arc(pos[0], pos[1], radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.3 + localAmp * 0.35 + waveHit * 0.35);
      ctx.fill();
    }
  },
};

// ============================================================================
// Relax — 「張り詰めた多角形が溶けてフローフィールドへ解放され、また静かに結晶化する」物語。
// ============================================================================

interface FlowParticle {
  x: number;
  y: number;
  life: number;
  seed: number;
}
interface FlowState {
  particles: FlowParticle[];
  noise: ReturnType<typeof createNoise3D>;
  rng: () => number;
}

const FLOW_PARTICLE_COUNT = 150;
const RELAX_PERIOD = 24; // 秒。緊張→溶解→解放→結晶化のサイクル

function resetFlowParticle(p: FlowParticle, f: Frame, rng: () => number): void {
  const margin = f.minDim * 0.05;
  p.x = f.cx + (rng() - 0.5) * (f.w - margin);
  p.y = f.cy + (rng() - 0.5) * (f.h - margin);
  p.life = 0.5 + rng() * 0.5;
  p.seed = rng() * 1000;
}

export const flowStyle: VisualStyle<FlowState> = {
  clearMode: "fade",
  fadeAlpha: 0.065,
  createState(seed) {
    const rng = mulberry32(seed);
    const noise = createNoise3D(rng);
    const particles: FlowParticle[] = Array.from({ length: FLOW_PARTICLE_COUNT }, () => ({
      x: 0,
      y: 0,
      life: 0,
      seed: 0,
    }));
    return { particles, noise, rng };
  },
  draw(f, state) {
    const { ctx, minDim, w, h, cx, cy, t, amp, rgb, hole } = f;
    const phase = cyclePhase(t, RELAX_PERIOD);

    // 物語: 0-0.3 張り詰めた多角形が明瞭 / 0.3-0.55 溶解（頂点から粒子が放たれる）
    // / 0.55-0.8 純粋なフロー / 0.8-1.0 静かに再結晶化
    let polyAlpha: number;
    if (phase < 0.3) polyAlpha = 1;
    else if (phase < 0.55) polyAlpha = 1 - easeInOutCubic((phase - 0.3) / 0.25);
    else if (phase < 0.8) polyAlpha = 0;
    else polyAlpha = easeInOutCubic((phase - 0.8) / 0.2);
    const dissolveBoost = smoothPulse(phase, 0.42, 0.16); // 溶ける瞬間だけ粒子が少し速く広がる

    // 背景の柔らかいブロブ
    for (let i = 0; i < 2; i++) {
      const angle = t * (0.03 + i * 0.012) + i * Math.PI;
      const orbitR = minDim * (0.14 + i * 0.05);
      const bx = cx + Math.cos(angle) * orbitR;
      const by = cy + Math.sin(angle) * orbitR * 0.7;
      const blobR = minDim * (0.22 + i * 0.05) * (0.85 + amp * 0.25);
      const grad = ctx.createRadialGradient(bx, by, 0, bx, by, blobR);
      grad.addColorStop(0, rgba(rgb, 0.07 + amp * 0.04));
      grad.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, blobR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 張り詰めた多角形（緊張の象徴）。ゆっくり回転し、溶解フェーズで消えていく
    if (polyAlpha > 0.01) {
      const sides = 6;
      const radius = Math.max(hole + minDim * 0.05, minDim * 0.2) * (0.94 + amp * 0.1);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.03);
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(rgb, 0.4 * polyAlpha);
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.stroke();
      ctx.restore();
    }

    for (const p of state.particles) {
      if (p.life <= 0) resetFlowParticle(p, f, state.rng);
      const n = state.noise(p.x * 0.0018, p.y * 0.0018, t * 0.06 + p.seed * 0.001);
      const angle = n * Math.PI * 4;
      const speed = minDim * 0.00045 * (0.4 + amp * 1.3 + dissolveBoost * 1.2);
      p.x += Math.cos(angle) * speed;
      p.y += Math.sin(angle) * speed;
      p.life -= 0.0022;

      const distFromCenter = Math.hypot(p.x - cx, p.y - cy);
      if (p.x < 0 || p.x > w || p.y < 0 || p.y > h || p.life <= 0 || distFromCenter < hole) {
        resetFlowParticle(p, f, state.rng);
        continue;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.8, minDim * 0.0012), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.28 * p.life);
      ctx.fill();
    }
  },
};

// ============================================================================
// Sleep — 「近くの星がゆっくり遠ざかり、深く沈んでいく」視差の物語 + 時折流れる星。
// ============================================================================

interface Star {
  nx: number;
  ny: number;
  size: number;
  phase: number;
  speed: number;
  depthPhase: number;
  depthSpeed: number;
}
interface Nebula {
  angle: number;
  orbitR: number;
  speed: number;
  sizeRatio: number;
}
interface StarfieldState {
  stars: Star[];
  nebulae: Nebula[];
  constellation: number[];
  seedBase: number;
}

const SLEEP_SHOOT_PERIOD = 8.5;

export const starfieldStyle: VisualStyle<StarfieldState> = {
  clearMode: "clear",
  createState(seed) {
    const rng = mulberry32(seed);
    const stars: Star[] = Array.from({ length: 190 }, () => ({
      nx: rng(),
      ny: rng(),
      size: 0.6 + rng() * 1.8,
      phase: rng() * Math.PI * 2,
      speed: 0.3 + rng() * 0.7,
      depthPhase: rng() * Math.PI * 2,
      depthSpeed: 0.015 + rng() * 0.02,
    }));
    const nebulae: Nebula[] = Array.from({ length: 3 }, (_, i) => ({
      angle: rng() * Math.PI * 2,
      orbitR: 0.05 + rng() * 0.1,
      speed: (0.01 + rng() * 0.015) * (i % 2 === 0 ? 1 : -1),
      sizeRatio: 0.2 + rng() * 0.16,
    }));
    const constellation = Array.from({ length: 7 }, () => Math.floor(rng() * stars.length));
    return { stars, nebulae, constellation, seedBase: seed * 97 + 13 };
  },
  draw(f, state) {
    const { ctx, w, h, cx, cy, minDim, t, amp, rgb } = f;

    for (const neb of state.nebulae) {
      const angle = neb.angle + t * neb.speed;
      const x = cx + Math.cos(angle) * minDim * neb.orbitR;
      const y = cy + Math.sin(angle) * minDim * neb.orbitR * 0.6;
      const r = minDim * neb.sizeRatio * (0.9 + amp * 0.2);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(rgb, 0.1 + amp * 0.05));
      grad.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 星座: 数個の星を薄い線でゆっくり回転しながら結ぶ
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.006);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = rgba(rgb, 0.14 + amp * 0.1);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [i, idx] of state.constellation.entries()) {
      const s = state.stars[idx]!;
      const x = s.nx * w;
      const y = s.ny * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // 星: 個々にゆっくり「近づいたり遠ざかったり」する視差の呼吸（深く沈んでいく物語）
    for (const s of state.stars) {
      const depth = 0.5 + 0.5 * Math.sin(t * s.depthSpeed + s.depthPhase); // 1=近い/大きい 0=遠い/小さい
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(t * s.speed + s.phase));
      const x = s.nx * w;
      const y = s.ny * h;
      const scale = 0.35 + depth * 0.85;
      const alphaDepth = 0.2 + depth * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, s.size * scale * (0.7 + twinkle * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, (0.12 + twinkle * 0.5) * alphaDepth);
      ctx.fill();
    }

    // 時折流れる星（物語のアクセント）
    const shootCycleIdx = Math.floor(t / SLEEP_SHOOT_PERIOD);
    const shootPhase = cyclePhase(t, SLEEP_SHOOT_PERIOD);
    if (shootPhase < 0.16) {
      const rngShoot = mulberry32(state.seedBase + shootCycleIdx * 733);
      const sx = rngShoot() * w * 0.7 + w * 0.15;
      const sy = rngShoot() * h * 0.3;
      const ex = sx - w * (0.18 + rngShoot() * 0.12);
      const ey = sy + h * (0.22 + rngShoot() * 0.1);
      const p = easeOutCubic(shootPhase / 0.16);
      const hx = sx + (ex - sx) * p;
      const hy = sy + (ey - sy) * p;
      const tailLen = 0.18;
      const tx = sx + (ex - sx) * Math.max(0, p - tailLen);
      const ty = sy + (ey - sy) * Math.max(0, p - tailLen);
      const grad = ctx.createLinearGradient(tx, ty, hx, hy);
      grad.addColorStop(0, rgba(rgb, 0));
      grad.addColorStop(1, rgba(rgb, 0.7));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1, minDim * 0.0018);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
  },
};

// ============================================================================
// Move — 「静けさから助走し、ピークで弾け、また落ち着く」インターバルの物語。
// ============================================================================

interface TrailParticle {
  freqX: number;
  freqY: number;
  phaseX: number;
  phaseY: number;
  radiusRatio: number;
  speedMul: number;
  sizeMul: number;
}
interface TrailsState {
  particles: TrailParticle[];
  seedBase: number;
}

const MOVE_PERIOD = 15; // 秒。助走→ピーク→クールダウンのインターバル周期

export const trailsStyle: VisualStyle<TrailsState> = {
  clearMode: "fade",
  fadeAlpha: 0.14,
  createState(seed) {
    const rng = mulberry32(seed);
    const particles: TrailParticle[] = Array.from({ length: 26 }, () => ({
      freqX: 1 + Math.floor(rng() * 3),
      freqY: 1 + Math.floor(rng() * 3),
      phaseX: rng() * Math.PI * 2,
      phaseY: rng() * Math.PI * 2,
      radiusRatio: 0.14 + rng() * 0.28,
      speedMul: 0.25 + rng() * 0.35,
      sizeMul: 0.7 + rng() * 1.1,
    }));
    return { particles, seedBase: seed * 131 + 7 };
  },
  draw(f, state) {
    const { ctx, cx, cy, minDim, t, amp, band, rgb, hole } = f;
    const phase = cyclePhase(t, MOVE_PERIOD);

    // エネルギー包絡線: 0-0.4 助走 / 0.4-0.55 ピーク保持 / 0.55-1.0 クールダウン
    let energy: number;
    if (phase < 0.4) energy = easeInOutCubic(phase / 0.4);
    else if (phase < 0.55) energy = 1;
    else energy = 1 - easeInOutCubic((phase - 0.55) / 0.45);

    const activeCount = Math.max(4, Math.round(state.particles.length * (0.25 + energy * 0.75)));
    for (let i = 0; i < activeCount; i++) {
      const p = state.particles[i]!;
      const localAmp = band((i % 5) * 0.15, (i % 5) * 0.15 + 0.35);
      const speed = t * p.speedMul * (0.35 + energy * 1.1 + amp * 0.8 + localAmp * 0.5);
      const rx = Math.max(hole + minDim * 0.02, minDim * p.radiusRatio);
      const ry = rx * 0.82;
      const x = cx + Math.sin(speed * p.freqX + p.phaseX) * rx;
      const y = cy + Math.sin(speed * p.freqY + p.phaseY) * ry;
      const radius = Math.max(1.2, minDim * 0.0026) * p.sizeMul * (0.55 + energy * 0.6 + localAmp * 0.5);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, 0.4 + energy * 0.35 + localAmp * 0.25);
      ctx.fill();
    }

    // ピーク到達の瞬間に中心から放射状のバースト（インターバルの山場）
    const burstWindow = smoothPulse(phase, 0.42, 0.06);
    if (burstWindow > 0.01) {
      const cycleIdx = Math.floor(t / MOVE_PERIOD);
      const rngBurst = mulberry32(state.seedBase + cycleIdx * 911);
      const rayCount = 14;
      for (let i = 0; i < rayCount; i++) {
        const a = (i / rayCount) * Math.PI * 2 + rngBurst();
        const len = minDim * (0.06 + rngBurst() * 0.18) * burstWindow;
        const x1 = cx + Math.cos(a) * (hole + minDim * 0.02);
        const y1 = cy + Math.sin(a) * (hole + minDim * 0.02);
        const x2 = cx + Math.cos(a) * (hole + minDim * 0.02 + len);
        const y2 = cy + Math.sin(a) * (hole + minDim * 0.02 + len);
        ctx.strokeStyle = rgba(rgb, 0.5 * burstWindow);
        ctx.lineWidth = Math.max(1, minDim * 0.002);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  },
};

export const VISUAL_STYLES: Record<VisualStyleId, VisualStyle<unknown>> = {
  lattice: latticeStyle as VisualStyle<unknown>,
  network: networkStyle as VisualStyle<unknown>,
  flow: flowStyle as VisualStyle<unknown>,
  starfield: starfieldStyle as VisualStyle<unknown>,
  trails: trailsStyle as VisualStyle<unknown>,
};
