import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { cyclePhase, easeOutCubic, mulberry32, rgba, smoothPulse, type VisualStyle } from "./shared";

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
const WORK_WAVE_PERIOD = STORY_PERIOD_SEC.network; // 成長の波の周期。シェーダー背景と同期

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
    // シェーダー背景と同じ式の呼吸（このスタイル特有の成長波に加えて、全体の明滅を2層で揃える）
    const breath = storyBreath(t, WORK_WAVE_PERIOD);

    const edgeAmp = band(0.05, 0.4);
    ctx.lineWidth = Math.max(0.7, minDim * 0.0009);
    for (const e of state.edges) {
      const [x1, y1] = positions[e.a]!;
      const [x2, y2] = positions[e.b]!;
      const midR = (Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - cx, y2 - cy)) / 2;
      const waveHit = smoothPulse(midR, waveRadius, waveBand);
      ctx.strokeStyle = rgba(rgb, (0.07 + edgeAmp * 0.14 + waveHit * 0.4) * breath);
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
      ctx.fillStyle = rgba(rgb, (0.3 + localAmp * 0.35 + waveHit * 0.35) * breath);
      ctx.fill();
    }

    // 副ネットワークレイヤー: 主ネットワークと同格の大きさを持つ、もう1つのノード網。
    // 独立した周期でゆっくり逆回転しながら現れては消え、主ネットワークと重なる瞬間だけ
    // 2つの網が一致して見える（参考: 2層グリッドの重ね合わせによるモアレ干渉技法）。
    // 「複数のプロジェクトが独立して進み、時々足並みが揃う」という Work の物語に沿わせる。
    const secondaryPeriod = WORK_WAVE_PERIOD * 1.45;
    const secondaryPhase = cyclePhase(t, secondaryPeriod);
    const secondaryAlpha = smoothPulse(secondaryPhase, 0.5, 0.46);
    if (secondaryAlpha > 0.015) {
      const secondaryCount = 10;
      const secondaryR = Math.max(hole + minDim * 0.06, minDim * 0.5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.015);
      const secondaryPos: Array<readonly [number, number]> = [];
      for (let i = 0; i < secondaryCount; i++) {
        const a = (i / secondaryCount) * Math.PI * 2;
        const r = secondaryR * (0.86 + 0.14 * Math.sin(a * 3 + t * 0.05));
        secondaryPos.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      ctx.strokeStyle = rgba(rgb, 0.16 * secondaryAlpha * breath);
      ctx.lineWidth = Math.max(0.7, minDim * 0.0009);
      ctx.beginPath();
      for (const [i, [x, y]] of secondaryPos.entries()) {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // 星形に対角も結び、主ネットワークの放射状の辺と呼応する密度を持たせる
      for (let i = 0; i < secondaryCount; i++) {
        const [x1, y1] = secondaryPos[i]!;
        const [x2, y2] = secondaryPos[(i + 3) % secondaryCount]!;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      for (const [x, y] of secondaryPos) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(1.2, minDim * 0.003), 0, Math.PI * 2);
        ctx.fillStyle = rgba(rgb, 0.22 * secondaryAlpha * breath);
        ctx.fill();
      }
      ctx.restore();
    }
  },
};
