import { STORY_PERIOD_SEC, storyBreath } from "../storyPeriods";
import { cyclePhase, easeInOutCubic, mulberry32, rgba, type VisualStyle } from "./shared";

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

const MOVE_PERIOD = STORY_PERIOD_SEC.trails; // 秒。助走→ピーク→クールダウンのインターバル周期。シェーダー背景と同期

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
    const breath = storyBreath(t, MOVE_PERIOD);

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
      ctx.fillStyle = rgba(rgb, (0.4 + energy * 0.35 + localAmp * 0.25) * breath);
      ctx.fill();
    }

    // 副リサージュ軌道: 主パーティクル群と同格の広がりを持つ、もう1つのリサージュ曲線。
    // 独立した周期数比（3:2）で常時軌道を描き、エネルギー包絡線が谷の間も
    // 「休んでいても止まらない鼓動」を画面いっぱいの規模で表す（中心の小さな点にはしない）。
    const secondaryPeriod = MOVE_PERIOD * 1.3;
    const secondaryBreath = storyBreath(t, secondaryPeriod);
    const secondaryRx = Math.max(hole + minDim * 0.05, minDim * 0.4);
    const secondaryRy = secondaryRx * 0.8;
    const secondarySpeed = t * 0.09;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    const secondarySteps = 260;
    for (let s = 0; s <= secondarySteps; s++) {
      const u = (s / secondarySteps) * Math.PI * 2;
      const x = Math.sin(3 * u + secondarySpeed) * secondaryRx;
      const y = Math.sin(2 * u) * secondaryRy;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = rgba(rgb, (0.14 + secondaryBreath * 0.18) * (0.5 + energy * 0.5));
    ctx.lineWidth = Math.max(0.8, minDim * 0.0012);
    ctx.stroke();
    ctx.restore();
  },
};
