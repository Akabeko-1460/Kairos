import { createNoise3D } from "simplex-noise";
import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { cyclePhase, easeInOutCubic, mulberry32, rgba, smoothPulse, type Frame, type VisualStyle } from "./shared";

// ============================================================================
// Relax — 「張り詰めた多角形が溶けてフローフィールドへ解放され、また静かに結晶化する」物語。
// ============================================================================

interface FlowParticle {
  x: number;
  y: number;
  life: number;
  seed: number;
}
interface LeafParticle {
  x: number;
  y: number;
  life: number;
  seed: number;
  heading: number; // 進行方向。急に向きを変えず、なめらかに追従させる
  sizeRatio: number; // minDim に対する比率
}
interface FlowState {
  particles: FlowParticle[];
  leaves: LeafParticle[];
  noise: ReturnType<typeof createNoise3D>;
  rng: () => number;
}

const FLOW_PARTICLE_COUNT = 150;
const FLOW_LEAF_COUNT = 10; // 葉。ドット粒子より少なく・大きく・ゆっくり
const RELAX_PERIOD = STORY_PERIOD_SEC.flow; // 秒。緊張→溶解→解放→結晶化のサイクル。シェーダー背景と同期

function resetFlowParticle(p: FlowParticle, f: Frame, rng: () => number): void {
  const margin = f.minDim * 0.05;
  p.x = f.cx + (rng() - 0.5) * (f.w - margin);
  p.y = f.cy + (rng() - 0.5) * (f.h - margin);
  p.life = 0.5 + rng() * 0.5;
  p.seed = rng() * 1000;
}

function resetLeaf(p: LeafParticle, f: Frame, rng: () => number): void {
  const margin = f.minDim * 0.06;
  p.x = f.cx + (rng() - 0.5) * (f.w - margin);
  p.y = f.cy + (rng() - 0.5) * (f.h - margin);
  p.life = 0.6 + rng() * 0.6;
  p.seed = rng() * 1000;
  p.heading = rng() * Math.PI * 2;
  p.sizeRatio = 0.014 + rng() * 0.012;
}

/**
 * 葉のシルエット（中央脈付きの木の葉形）を風に揺れる姿で描く。
 * 抽象的な生成アートの語彙（曲線・粒子）を崩さないまま「葉」だと分かる程度に具象化する。
 */
function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  alpha: number,
  rgb: readonly [number, number, number],
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.bezierCurveTo(size * 0.62, -size * 0.42, size * 0.62, size * 0.5, 0, size);
  ctx.bezierCurveTo(-size * 0.62, size * 0.5, -size * 0.62, -size * 0.42, 0, -size);
  ctx.closePath();
  ctx.fillStyle = rgba(rgb, alpha);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.82);
  ctx.lineTo(0, size * 0.82);
  ctx.strokeStyle = rgba(rgb, alpha * 1.4);
  ctx.lineWidth = Math.max(0.6, size * 0.06);
  ctx.stroke();
  ctx.restore();
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
    const leaves: LeafParticle[] = Array.from({ length: FLOW_LEAF_COUNT }, () => ({
      x: 0,
      y: 0,
      life: 0,
      seed: 0,
      heading: 0,
      sizeRatio: 0.018,
    }));
    return { particles, leaves, noise, rng };
  },
  draw(f, state) {
    const { ctx, minDim, w, h, cx, cy, t, amp, rgb, hole } = f;
    const phase = cyclePhase(t, RELAX_PERIOD);
    const breath = storyBreath(t, RELAX_PERIOD);

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
      grad.addColorStop(0, rgba(rgb, (0.07 + amp * 0.04) * breath));
      grad.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, blobR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 張り詰めた多角形（緊張の象徴）。ゆっくり回転し、溶解フェーズで消えていく
    if (polyAlpha > 0.01) {
      const sides = 6;
      const radius = Math.max(hole + minDim * 0.04, minDim * 0.17) * (0.94 + amp * 0.1);
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
      ctx.strokeStyle = rgba(rgb, 0.045 * polyAlpha * breath);
      ctx.lineWidth = Math.max(0.7, minDim * 0.0011);
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
      ctx.fillStyle = rgba(rgb, 0.28 * p.life * breath);
      ctx.fill();
    }

    // 副多角形レイヤー: 主六角形と同格の大きさを持つ、もう1つの多角形（十角形）。
    // 独立した周期・逆方向のゆっくりした回転で主多角形を包み込むように現れては溶け、
    // 「張り詰め→解放」の物語がもう1つの時間軸でも並走しているように見せる
    // （参考: 2層グリッドの重ね合わせによるモアレ干渉技法。中心の小さな飾りにはしない）。
    const secondaryPeriod = RELAX_PERIOD * 1.4;
    const secondaryPhase = cyclePhase(t, secondaryPeriod);
    let secondaryAlpha: number;
    if (secondaryPhase < 0.3) secondaryAlpha = easeInOutCubic(secondaryPhase / 0.3);
    else if (secondaryPhase < 0.7) secondaryAlpha = 1;
    else secondaryAlpha = 1 - easeInOutCubic((secondaryPhase - 0.7) / 0.3);
    if (secondaryAlpha > 0.01) {
      const sides = 10;
      const radius = Math.max(hole + minDim * 0.07, minDim * 0.24) * (0.96 + amp * 0.08);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-t * 0.018);
      ctx.beginPath();
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const x = Math.cos(a) * radius;
        const y = Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(rgb, 0.025 * secondaryAlpha * breath);
      ctx.lineWidth = Math.max(0.6, minDim * 0.0009);
      ctx.stroke();
      ctx.restore();
    }

    // 葉: フローフィールドに乗って漂う木の葉（緊張の象徴だった多角形に代わり、
    // 「自然の中で佇む」物語の主役をこちらへ渡す）。粒子と同じノイズ場を使うことで
    // 「同じ風・同じ水面」を漂っているという一体感を保つ。
    for (const leaf of state.leaves) {
      if (leaf.life <= 0) resetLeaf(leaf, f, state.rng);
      const n = state.noise(leaf.x * 0.0014, leaf.y * 0.0014, t * 0.05 + leaf.seed * 0.001);
      const flowAngle = n * Math.PI * 4;
      const speed = minDim * 0.00022 * (0.5 + amp * 0.9);
      leaf.x += Math.cos(flowAngle) * speed;
      leaf.y += Math.sin(flowAngle) * speed;
      leaf.life -= 0.0009;
      // 進行方向へゆっくり向きを合わせつつ、常に一定量だけ揺れ続ける（風に揺れる葉のふるまい）
      let headingDiff = flowAngle - leaf.heading;
      headingDiff = Math.atan2(Math.sin(headingDiff), Math.cos(headingDiff));
      leaf.heading += headingDiff * 0.01;
      const sway = Math.sin(t * 0.6 + leaf.seed) * 0.35;

      const distFromCenter = Math.hypot(leaf.x - cx, leaf.y - cy);
      if (leaf.x < 0 || leaf.x > w || leaf.y < 0 || leaf.y > h || leaf.life <= 0 || distFromCenter < hole) {
        resetLeaf(leaf, f, state.rng);
        continue;
      }

      const size = minDim * leaf.sizeRatio * (0.85 + amp * 0.3);
      const alpha = 0.22 * leaf.life * breath;
      drawLeaf(ctx, leaf.x, leaf.y, size, leaf.heading + Math.PI / 2 + sway, alpha, rgb);
    }
  },
};
