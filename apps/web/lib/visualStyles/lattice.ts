import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { cyclePhase, easeInOutCubic, mulberry32, rgba, type VisualStyle } from "./shared";

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
const STUDY_PERIOD = STORY_PERIOD_SEC.lattice; // シェーダー背景と同じ周期で呼吸を揃える

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
    // シェーダー背景（lib/shaderVisual.ts）と全く同じ式の呼吸。2層が同じ脈で明滅することで
    // 別々のエフェクトの重ね合わせではなく1つの作品として融合して見える。
    const breath = storyBreath(t, STUDY_PERIOD);

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
      ctx.strokeStyle = rgba(rgb, (major ? 0.4 + bandAmp * 0.3 : 0.14) * (0.25 + converge * 0.75) * breath);
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
      ctx.strokeStyle = rgba(rgb, (0.28 + curveAmp * 0.32) * (0.2 + converge * 0.8) * breath);
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
      const alpha = (0.12 + converge * 0.55 + amp * 0.08) * breath;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = rgba(rgb, alpha);
      ctx.fill();
    }

    // 副曲線レイヤー: 主曲線群と同格の大きさを持つ、もう1つのハイポトロコイド曲線。
    // 主レイヤーとは独立した周期・逆方向の回転で重なり合うことで、2枚のガラスを
    // ずらして重ねたようなモアレ干渉が生まれる（参考: 2層スピログラフの重ね合わせ技法）。
    // 中心付近だけの小さな飾りではなく、主曲線と同じ画面占有率で「もう1つの物語」を語る。
    const secondaryPeriod = STUDY_PERIOD * 1.7; // 主周期と整数比にせず、ゆっくり位相がずれ続けるようにする
    const secondaryBreath = storyBreath(t, secondaryPeriod);
    const secondaryR = Math.max(hole + minDim * 0.05, minDim * 0.44);
    const secondaryR2 = secondaryR / 13;
    const secondaryD = secondaryR2 * 0.46 * (0.85 + amp * 0.2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-t * 0.017);
    ctx.beginPath();
    const secondarySteps = 420;
    for (let s = 0; s <= secondarySteps; s++) {
      const th = (s / secondarySteps) * Math.PI * 2;
      const [x, y] = hypotrochoidPoint(secondaryR, secondaryR2, secondaryD, th);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(rgb, (0.14 + secondaryBreath * 0.16) * (0.3 + converge * 0.5));
    ctx.lineWidth = Math.max(0.8, minDim * 0.001);
    ctx.stroke();
    ctx.restore();
  },
};
